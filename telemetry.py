"""Read LMU recordings and correlate session results without modifying either."""
import bisect
from contextlib import contextmanager
import csv
from datetime import datetime
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import zipfile
from itertools import chain
import xml.etree.ElementTree as ET

import duckdb


def db(path):
    return duckdb.connect(str(path), read_only=True, config={'enable_external_access': 'false'})


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def records(con, name, columns='*', order='rowid'):
    return con.execute(f'SELECT {columns} FROM {quoted(name)} ORDER BY {order}').fetchall()


def events(con, names, name):
    return records(con, name, order='ts, rowid') if name in names else []


def iso_name(metadata, path):
    return metadata.get('RecordingTime') or path.name


def finite(value):
    return value if not isinstance(value, float) or math.isfinite(value) else None


IN_CAR_SETTINGS = (
    'TCLevel', 'TCCut', 'TCSlipAngle', 'ABSLevel', 'Brake Bias Rear',
    'Brake Migration', 'FuelMixtureMap',
)
HYPERCAR_SETUP_KEYS = ('VM_REGEN_LEVEL', 'VM_ELECTRIC_MOTOR_MAP', 'VM_ENGINE_BRAKEMAP')


def hypercar_setup(raw):
    try:
        setup = json.loads(raw or '{}')
    except (TypeError, ValueError):
        return {}
    if not isinstance(setup, dict):
        return {}
    settings = {}
    for key in HYPERCAR_SETUP_KEYS:
        entry = setup.get(key)
        if not isinstance(entry, dict) or not entry.get('available'):
            continue
        value = entry.get('stringValue')
        if isinstance(value, str) and value.strip().casefold() not in ('', 'n/a', 'non-adjustable'):
            settings[key] = value.strip()
    return settings


def weather_description(cloud, path_wetness, off_path_wetness):
    conditions = []
    if path_wetness is not None and path_wetness > 0:
        conditions.append('Wet track')
    elif off_path_wetness is not None and off_path_wetness > 0:
        conditions.append('Damp off-line' if path_wetness == 0 else 'Wet off-line')
    elif path_wetness == 0 and off_path_wetness in (None, 0):
        conditions.append('Dry track')
    if cloud is not None and cloud > 0:
        conditions.append('Dark clouds')
    return ' · '.join(conditions) or None


def sampled_lap_ends(con, channel, columns, laps, start, finish, rate):
    if not rate or rate <= 0:
        return {}

    sample_ids = {}
    for lap in laps:
        first = max(0, math.ceil((lap['start'] - start) * rate - 1e-6))
        last = math.ceil((lap['end'] - start) * rate - 1e-6) - 1
        if lap['end'] == finish:
            last = math.floor((finish - start) * rate + 1e-6)
        if last >= first:
            sample_ids[lap['id']] = last
    if not sample_ids:
        return {}

    ids = sorted(set(sample_ids.values()))
    slots = ','.join('?' for _ in ids)
    columns_sql = ', '.join(columns)
    samples = {}
    for rowid, *values in con.execute(
        f'SELECT rowid, {columns_sql} FROM {quoted(channel)} WHERE rowid IN ({slots})', ids
    ).fetchall():
        numeric = [value for value in values if value is not None and math.isfinite(value)]
        if numeric:
            samples[rowid] = max(numeric)
    return {lap_id: samples[rowid] for lap_id, rowid in sample_ids.items() if rowid in samples}


def sampled_lap_peaks(con, channel, columns, laps, start, finish, rate):
    if not rate or rate <= 0 or not laps:
        return {}
    bounds = []
    for lap in laps:
        first = max(0, math.ceil((lap['start'] - start) * rate - 1e-6))
        end = math.ceil((lap['end'] - start) * rate - 1e-6)
        if lap['end'] == finish:
            end = math.floor((finish - start) * rate + 1e-6) + 1
        bounds.append((lap['id'], first, end))
    slots = ','.join('(?, ?, ?)' for _ in bounds)
    finite_columns = [f'CASE WHEN isfinite({column}) THEN {column} END' for column in columns]
    hottest = 'greatest(' + ', '.join(finite_columns) + ')' if len(columns) > 1 else finite_columns[0]
    return dict(con.execute(
        f'WITH lap_bounds(id, first_sample, end_sample) AS (VALUES {slots}) '
        f'SELECT id, max({hottest}) FROM lap_bounds '
        f'JOIN {quoted(channel)} ON rowid >= first_sample AND rowid < end_sample '
        f'GROUP BY id HAVING max({hottest}) IS NOT NULL',
        [value for bound in bounds for value in bound]
    ).fetchall())


def consumption_by_lap(con, channel, laps, start, rate):
    if not rate or rate <= 0:
        return {}
    boundaries = {
        lap['id']: (round((lap['start'] - start) * rate), round((lap['end'] - start) * rate))
        for lap in laps if lap['kind'] == 'complete'
    }
    sample_ids = sorted({index for pair in boundaries.values() for index in pair})
    if not sample_ids:
        return {}
    slots = ','.join('?' for _ in sample_ids)
    samples = dict(con.execute(f'SELECT rowid, value FROM {quoted(channel)} WHERE rowid IN ({slots})',
                               sample_ids).fetchall())
    used = {}
    for lap_id, (first, last) in boundaries.items():
        before, after = finite(samples.get(first)), finite(samples.get(last))
        if before is not None and after is not None and before >= after:
            used[str(lap_id)] = before - after
    return used


def inspect(path):
    with db(path) as con:
        names = {row[0] for row in con.execute('SHOW TABLES').fetchall()}
        metadata = dict(records(con, 'metadata'))
        clocks = con.execute('SELECT first(value ORDER BY rowid), last(value ORDER BY rowid) FROM "GPS Time"').fetchone()
        start, end = clocks
        if start is None or end is None:
            raise ValueError('Recording has no GPS clock')
        crossings = events(con, names, 'Lap')
        times = events(con, names, 'Lap Time')
        pits = events(con, names, 'In Pits')
        sector_events = [
            dict(events(con, names, channel)) for channel in ('Last Sector1', 'Last Sector2')
        ]
        pit_times = [row[0] for row in pits]
        laps = []
        if not crossings or crossings[0][0] > start + .1:
            crossings.insert(0, (start, None))
        for index, (at, number) in enumerate(crossings):
            following = crossings[index + 1] if index + 1 < len(crossings) else None
            finish = min(following[0], end) if following else end
            if finish <= at:
                continue
            pit_index = bisect.bisect_right(pit_times, at)
            before_finish = bisect.bisect_left(pit_times, finish, lo=pit_index)
            at_finish = bisect.bisect_right(pit_times, finish, lo=before_finish)
            pit_lane_at_boundary = bool((pit_index and pits[pit_index - 1][1]) or
                                        (at_finish and pits[at_finish - 1][1]))
            in_pits = pit_lane_at_boundary or any(state for _, state in pits[pit_index:before_finish])
            timing = next((value for ts, value in times if abs(ts - finish) <= .05), None)
            if timing is None and following:
                # Events can omit an unchanged value. Require agreement with the crossing clock.
                previous = next((value for ts, value in reversed(times) if ts <= finish), None)
                if previous and abs(previous - (finish - at)) <= .04:
                    timing = previous
            kind = 'partial'
            if index == 0:
                kind = 'out-lap' if following and in_pits else 'partial'
            elif following:
                kind = 'in-lap' if in_pits else 'complete'
            lap_time = timing if kind == 'complete' and timing and timing > 0 else None
            s1, s12 = (data.get(finish) for data in sector_events)
            splits = [None, None, None]
            if lap_time and s1 and s12 and 0 < s1 < s12 < lap_time:
                splits = [s1, s12 - s1, lap_time - s12]
            laps.append(dict(sectors=splits, id=index, number=number, start=at, end=finish, kind=kind,
                             pitLaneAtBoundary=pit_lane_at_boundary, time=lap_time, validity='unconfirmed' if lap_time else 'untimed'))
        if not laps and end == start:
            pit_index = bisect.bisect_right(pit_times, start)
            laps.append(dict(sectors=[None, None, None], id=0, number=None, start=start, end=end, kind='partial',
                             pitLaneAtBoundary=bool(pit_index and pits[pit_index - 1][1]),
                             time=None, validity='untimed'))

        def summary(name, expression, default):
            return con.execute(f'SELECT {expression} FROM {quoted(name)}').fetchone() if name in names else default

        fuel = summary('Fuel Level', 'first(value ORDER BY rowid), last(value ORDER BY rowid)', (None, None))
        speed, speed_sum = summary('Ground Speed',
                                   'max(value) FILTER (WHERE isfinite(value)), '
                                   'sum(value) FILTER (WHERE isfinite(value) AND value >= 0)', (None, None))
        sampled = records(con, 'channelsList') if 'channelsList' in names else []
        logged_events = records(con, 'eventsList') if 'eventsList' in names else []
        rates = {name: frequency for name, frequency, _ in sampled}
        summary_channels = [name for name, frequency, _ in sampled if name in names and frequency > 0]
        summary_channels.extend(name for name, _ in logged_events if name in names)
        speed_rate = rates.get('Ground Speed')
        if 'Ground Speed' in names and speed_rate and speed_rate > 0 and laps:
            # Use the same sample clock and end-exclusive lap interval as the lap reader.
            bounds = [(lap['id'], max(0, math.ceil((lap['start'] - start) * speed_rate - 1e-6)),
                       math.ceil((lap['end'] - start) * speed_rate - 1e-6))
                      for lap in laps]
            slots = ','.join('(?, ?, ?)' for _ in bounds)
            lap_speeds = dict(con.execute(
                f'WITH lap_bounds(id, first_sample, end_sample) AS (VALUES {slots}) '
                f'SELECT id, max(value) FILTER (WHERE isfinite(value) AND value >= 0) '
                f'FROM lap_bounds LEFT JOIN "Ground Speed" ON rowid >= first_sample AND rowid < end_sample GROUP BY id',
                [value for bound in bounds for value in bound]
            ).fetchall())
        else:
            lap_speeds = {}
        for lap in laps:
            lap['topSpeed'] = finite(lap_speeds.get(lap['id']))
        distance_km = None
        if speed_sum is not None and speed_rate and speed_rate > 0:
            # Integrate sampled km/h. The lap-based Total Dist channel jumps on garage resets.
            distance_km = speed_sum / (3600 * speed_rate)
        wheel_columns = tuple(f'value{i}' for i in range(1, 5))
        chart_channels = {
            'tyres': ('TyresTempCentre', wheel_columns),
            'frontBrakes': ('Brakes Temp', wheel_columns[:2]),
            'rearBrakes': ('Brakes Temp', wheel_columns[2:]),
            'oil': ('Engine Oil Temp', ('value',)),
            'water': ('Engine Water Temp', ('value',)),
            'air': ('Ambient Temperature', ('value',)),
            'track': ('Track Temperature', ('value',)),
        }
        peak_temperatures_by_lap = {
            key: sampled_lap_peaks(con, channel, columns, laps, start, end, rates.get(channel))
            for key, (channel, columns) in chart_channels.items() if channel in names
        }
        chart_endpoints = {}
        for key in ('tyres', 'frontBrakes', 'rearBrakes', 'oil', 'water'):
            channel, columns = chart_channels[key]
            finite_columns = [
                f'CASE WHEN isfinite({column}) THEN {column} END' for column in columns
            ]
            hottest = 'greatest(' + ', '.join(finite_columns) + ')' if len(columns) > 1 else finite_columns[0]
            chart_endpoints[key] = summary(channel,
                f'first({hottest} ORDER BY rowid), last({hottest} ORDER BY rowid)', (None, None))

        energy_by_lap = consumption_by_lap(con, 'Virtual Energy', laps, start, rates.get('Virtual Energy')) if 'Virtual Energy' in names else {}
        temperature_endpoints = {
            key: [finite(value) for value in summary(channel,
                   'first(value ORDER BY rowid), last(value ORDER BY rowid)', (None, None))]
            for key, channel in [('air', 'Ambient Temperature'), ('track', 'Track Temperature')]
        }
        def condition_endpoints(channel):
            return summary(channel,
                           'first(value ORDER BY rowid) FILTER (WHERE isfinite(try_cast(value AS DOUBLE))), '
                           'last(value ORDER BY rowid) FILTER (WHERE isfinite(try_cast(value AS DOUBLE)))',
                           (None, None))

        weather_channels = [condition_endpoints(channel) for channel in
                            ('CloudDarkness', 'Minimum Path Wetness', 'OffpathWetness')]
        weather_endpoints = [weather_description(*values) for values in zip(*weather_channels)]
        conditions = {'wetness': weather_channels[1],
                      'windSpeed': condition_endpoints('Wind Speed'),
                      'windHeading': condition_endpoints('Wind Heading')}
        settings = {}
        for name in IN_CAR_SETTINGS:
            values = [value for _, value in events(con, names, name) if value is not None and finite(value) is not None]
            if values:
                settings[name] = {'initial': values[0], 'final': values[-1],
                                  'changes': sum(a != b for a, b in zip(values, values[1:]))}
    return dict(path=str(path), filename=path.name, recorded=iso_name(metadata, path),
                driver=metadata.get('DriverName', ''), track=metadata.get('TrackLayout') or metadata.get('TrackName', ''),
                trackName=metadata.get('TrackName', ''), trackLayout=metadata.get('TrackLayout', ''),
                trackLayoutVersion=metadata.get('TrackLayoutVersion') or metadata.get('TrackVersion') or '',
                gameVersion=metadata.get('GameVersion', ''),
                car=metadata.get('CarName', ''), carClass=metadata.get('CarClass', ''), session=metadata.get('SessionType', ''),
                fuel=[finite(v) for v in fuel], speed=finite(speed), distanceKm=finite(distance_km), durationSeconds=finite(end - start), laps=laps, summaryChannels=summary_channels,
                sessionSummary={'settings': settings, 'energyUsedByLap': energy_by_lap, 'temperatureEndpoints': temperature_endpoints, 'weatherEndpoints': weather_endpoints, 'conditionEndpoints': conditions, 'peakTemperaturesByLap': peak_temperatures_by_lap, 'chartEndpoints': chart_endpoints, 'hypercarSetup': hypercar_setup(metadata.get('CarSetup'))})


def read_results(path):
    if path.stat().st_size > 30_000_000:
        raise ValueError('Results file exceeds 30 MB')
    tree = ET.parse(path)
    root = tree.find('.//RaceResults')
    if root is None:
        root = tree.getroot()
    track = root.findtext('TrackCourse') or root.findtext('TrackVenue') or ''
    drivers = []
    for stage in root:
        for driver in stage.findall('Driver'):
            def numeric(value):
                try:
                    number = float(value)
                    return number if math.isfinite(number) else None
                except (TypeError, ValueError):
                    return None

            laps = [dict(number=int(lap.get('num', '0')), et=numeric(lap.get('et')),
                         sectors=[numeric(lap.get(f's{i}')) for i in range(1, 4)],
                         time=numeric(lap.text), position=numeric(lap.get('p')), pit=lap.get('pit') == '1') for lap in driver.findall('Lap')]
            drivers.append(dict(driver=driver.findtext('Name', ''), car=driver.findtext('VehName', ''),
                                model=driver.findtext('CarType', ''), carClass=driver.findtext('CarClass', ''),
                                stage=stage.tag, laps=laps,
                                qualifyingPosition=driver.findtext('ClassPosition') if stage.tag.lower().startswith('qual') else None,
                                raceResult={key: numeric(driver.findtext(tag)) for key, tag in {
                                    'position': 'Position', 'classPosition': 'ClassPosition',
                                    'grid': 'GridPos', 'best': 'BestLapTime', 'laps': 'Laps',
                                    'finishTime': 'FinishTime',
                                }.items()} if stage.tag.lower().startswith('race') else None))
    event_start = root.findtext('DateTime', '').strip()
    event = (event_start, root.findtext('Setting', ''), root.findtext('ServerName', ''))
    try:
        recorded = datetime.strptime(root.findtext('TimeString', '').strip(), '%Y/%m/%d %H:%M:%S').isoformat()
    except ValueError:
        recorded = ''
    return dict(path=str(path), track=track, venue=root.findtext('TrackVenue', '').strip(),
                recorded=recorded, event=event, gameVersion=root.findtext('GameVersion', '').strip(), drivers=drivers)


def normalize(value):
    return ' '.join(value.casefold().split())


CAR_CLASSES = {
    'gte': 'GTE', 'lmgte': 'GTE',
    'gt3': 'GT3', 'lmgt3': 'GT3',
    'lmp3': 'LMP3', 'lmp3elms': 'LMP3', 'elmslmp3': 'LMP3',
    'lmp2': 'LMP2', 'lmp2wec': 'LMP2', 'weclmp2': 'LMP2',
    'lmp2elms': 'LMP2', 'elmslmp2': 'LMP2', 'lmp2elmsspec': 'LMP2',
    'hyper': 'Hypercar', 'hypercar': 'Hypercar', 'lmh': 'Hypercar', 'lmdh': 'Hypercar',
}


def car_class(value):
    return CAR_CLASSES.get(re.sub(r'[^a-z0-9]', '', value.casefold()), '')


def session_model(car):
    return re.sub(r'\s+custom team\b.*$', '', car, flags=re.IGNORECASE).strip()


def race_gaps(drivers):
    drivers = list(drivers)
    leader_times, class_times = {}, {}
    field = []
    for driver in drivers:
        crossings = []
        category = car_class(driver['carClass']) or driver['carClass'].strip()
        for lap, next_lap in zip(driver['laps'], driver['laps'][1:] + [None]):
            number, start, duration = lap['number'], lap['et'], lap['time']
            if number <= 0 or start is None:
                continue
            if duration and duration > 0:
                finish = start + duration
            elif next_lap and next_lap['number'] == number + 1 and next_lap['et'] is not None and next_lap['et'] > start:
                finish = next_lap['et']
            else:
                continue
            crossings.append((number, finish))
            leader_times[number] = min(finish, leader_times.get(number, finish))
            key = (category, number)
            class_times[key] = min(finish, class_times.get(key, finish))
        positions = [[lap['number'], int(position)] for lap in driver['laps']
                     if lap['number'] > 0 and (position := lap['position']) is not None
                     and position.is_integer() and 1 <= position <= len(drivers) and lap['et'] is not None]
        field.append((driver, category, crossings, positions))

    return [dict(driver=driver['driver'], car=driver['car'], category=category,
                 result=driver['raceResult'], positions=positions,
                 pitLaps=[lap['number'] for lap in driver['laps'] if lap['pit']],
                 lapTimes=[[lap['number'], lap['time']] for lap in driver['laps']
                           if lap['time'] and lap['time'] > 0 and not lap['pit']],
                 gaps=[[number, round(finish - leader_times[number], 3),
                        round(finish - class_times[category, number], 3)] for number, finish in crossings],
                 lastCrossing=crossings[-1] if crossings else None)
            for driver, category, crossings, positions in field]


def correlate(recording, results):
    candidates = []
    identity = tuple(normalize(recording[k]) for k in ('driver', 'car'))
    complete = [lap for lap in recording['laps'] if lap['kind'] in ('complete', 'in-lap')]
    for result in results:
        if normalize(recording['track']) != normalize(result['track']):
            continue
        for driver in result['drivers']:
            if tuple(normalize(driver[k]) for k in ('driver', 'car')) != identity:
                continue
            stage = driver['stage'].lower()
            session = recording['session'].lower()
            if session.startswith('practice') and not stage.startswith('practice'):
                continue
            if session.startswith('qual') and not stage.startswith('qual'):
                continue
            if session.startswith('race') and not stage.startswith('race'):
                continue
            mapping = {}
            for lap in complete:
                matches = [row for row in driver['laps'] if row['et'] is not None
                           and abs(row['et'] - lap['start']) <= .08]
                if len(matches) == 1:
                    mapping[lap['id']] = matches[0]
            anchors = [lap for lap in complete if lap['time'] and lap['id'] in mapping]
            agreements = sum(abs((mapping[lap['id']]['time'] or 0) - lap['time']) <= .04 for lap in anchors)
            if agreements and agreements == len(anchors):
                candidates.append(((agreements, len(mapping)), result, driver, mapping))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return None
    _, result, driver, mapping = candidates[0]
    for lap in complete:
        row = mapping.get(lap['id'])
        if row is None:
            continue
        lap['xmlLap'] = row['number']
        if row['pit'] or lap['kind'] == 'in-lap':
            lap.update(kind='in-lap', time=None, validity='untimed')
        elif row['time'] and row['time'] > 0:
            lap.update(time=row['time'], validity='official',
                       sectors=[split if split is not None and 0 < split < row['time'] else fallback
                                for split, fallback in zip(row['sectors'], lap['sectors'])])
        else:
            lap.update(time=None, validity='no official time')
    match = dict(path=result['path'], model=driver['model'], carClass=driver['carClass'], gameVersion=result['gameVersion'], event=tuple(result['event']),
                 qualifyingPosition=driver['qualifyingPosition'])
    if recording['session'].lower().startswith('race'):
        match['raceGaps'] = race_gaps(row for row in result['drivers'] if row['stage'] == driver['stage'])
    return match


def qualifying_position(race, race_match, prior, prior_match):
    if not prior_match or not prior['session'].lower().startswith('qual'):
        return None
    identity = ('driver', 'car', 'track', 'trackLayoutVersion', 'carClass')
    if not race['carClass'] or any(normalize(race[key]) != normalize(prior[key]) for key in identity):
        return None
    if race_match['path'] != prior_match['path']:
        if not race_match['event'][0] or race_match['event'] != prior_match['event']:
            return None
    position = prior_match['qualifyingPosition']
    return int(position) if position and position.strip().isdigit() and int(position) > 0 else None


def directory(folder, suffix):
    return sorted(p for p in Path(folder).glob('*') if p.is_file() and p.suffix.lower() == suffix) if folder else []


def results_track_records(results, recordings, primary_driver):
    driver_filter = normalize(primary_driver or '')
    matched_tracks = {}
    for item in recordings:
        if item['results']:
            dimensions = (item['trackName'] or item['track'], item['trackLayout'] or item['track'])
            matched_tracks.setdefault(item['results'], set()).add(dimensions)

    records = {}
    for result in results:
        if not result['track'].strip():
            continue
        dimensions = matched_tracks.get(result['path'], set())
        track, layout = (next(iter(dimensions)) if len(dimensions) == 1
                         else (result['venue'] or result['track'], result['track']))
        for driver in result['drivers']:
            name = driver['driver'].strip()
            model = driver['model'].strip() or session_model(driver['car']).strip()
            if not name or not model or (driver_filter and normalize(name) != driver_filter):
                continue
            timed = [lap for lap in driver['laps']
                     if lap['number'] > 0 and not lap['pit'] and lap['time'] and 0 < lap['time'] <= 86400]
            if not timed:
                continue
            best = min(timed, key=lambda lap: lap['time'])
            category = car_class(driver['carClass'])
            key = (track, layout, normalize(name), model, category, result['gameVersion'])
            if key in records and records[key]['laps'][0]['time'] <= best['time']:
                continue

            def split(lap, index):
                value = lap['sectors'][index]
                return value if value is not None and 0 < value < lap['time'] else None
            sectors = [split(best, index) for index in range(3)]
            best_sectors = [min((value for lap in timed if (value := split(lap, index)) is not None), default=None)
                            for index in range(3)]
            records[key] = dict(trackName=track, trackLayout=layout, driver=name, model=model,
                                carClass=category, gameVersion=result['gameVersion'], recorded=result['recorded'],
                                resultOnly=True, bestSectors=best_sectors,
                                laps=[dict(number=best['number'], kind='complete', validity='official',
                                           time=best['time'], sectors=sectors)])
    return list(records.values())


def index(payload):
    cache_path = Path(payload['cache'])
    try:
        previous = json.loads(cache_path.read_text(encoding='utf8'))
    except (OSError, ValueError):
        previous = {}
    cached = {}
    errors = []

    def load(path, parser):
        key = str(path)
        try:
            stats = path.stat()
            stamp = [stats.st_mtime_ns, stats.st_size]
            entry = previous.get(key)
            needs_update = False
            if entry:
                data = entry['data']
                if parser is inspect:
                    session_summary = data.get('sessionSummary', {})
                    needs_update = (
                        not {'summaryChannels', 'carClass', 'durationSeconds', 'trackName', 'trackLayout', 'trackLayoutVersion', 'gameVersion'} <= data.keys()
                        or not {'peakTemperaturesByLap', 'chartEndpoints', 'energyUsedByLap', 'temperatureEndpoints',
                                'weatherEndpoints', 'conditionEndpoints', 'hypercarSetup'} <= session_summary.keys()
                        or not {'frontBrakes', 'rearBrakes'} <= session_summary.get('chartEndpoints', {}).keys()
                        or any(not {'sectors', 'topSpeed', 'pitLaneAtBoundary'} <= lap.keys() for lap in data['laps'])
                    )
                else:
                    needs_update = not {'event', 'venue', 'recorded', 'gameVersion'} <= data.keys() or any('carClass' not in driver or 'raceResult' not in driver or any(not {'sectors', 'position'} <= lap.keys() for lap in driver['laps'])
                                       for driver in data['drivers'])
            if not entry or entry['stamp'] != stamp or needs_update:
                entry = dict(stamp=stamp, data=parser(path))
            cached[key] = entry
            # Correlation augments a copy, leaving the cached telemetry as read.
            if parser is inspect:
                return {**json.loads(json.dumps(entry['data'])), 'recordingStamp': f'{stamp[0]}:{stamp[1]}'}
            return entry['data']
        except (OSError, ValueError, duckdb.Error, ET.ParseError) as exc:
            errors.append(f'{path.name}: {exc}')
            return None

    results = [data for path in directory(payload.get('results'), '.xml') if (data := load(path, read_results))]
    items = [data for path in directory(payload.get('telemetry'), '.duckdb') if (data := load(path, inspect))]
    matches = {}
    for item in items:
        match = correlate(item, results)
        matches[item['path']] = match
        item['results'] = match['path'] if match else None
        if match and 'raceGaps' in match:
            item['raceGaps'] = match['raceGaps']
        item['model'] = (match['model'] if match else '') or session_model(item['car'])
        item['carClass'] = car_class(item['carClass']) or car_class(match['carClass'] if match else '')
        item['gameVersion'] = item['gameVersion'] or (match['gameVersion'] if match else '')
        times = [lap['time'] for lap in item['laps'] if lap['time']]
        item['best'] = min(times, default=None)
        item['timed'] = len(times)
    prior = None
    for item in sorted(items, key=lambda item: item['recorded']):
        if prior and 'raceGaps' in item and prior['recorded'] < item['recorded']:
            item['qualifyingPosition'] = qualifying_position(item, matches[item['path']], prior, matches[prior['path']])
        prior = item
    # Attach a known model to other recordings of the same exact vehicle.
    known = {normalize(item['car']): item['model'] for item in items if item['results']}
    for item in items:
        item['model'] = known.get(normalize(item['car']), item['model'])
    if cached != previous:
        temporary = cache_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(cached, allow_nan=False), encoding='utf8')
        os.replace(temporary, cache_path)
    return dict(sessions=sorted(items, key=lambda x: x['recorded'], reverse=True), errors=errors,
                resultRecords=results_track_records(results, items, payload.get('primaryDriver')),
                resultGameVersions=sorted({result['gameVersion'] for result in results if result['gameVersion']}))


def results_distance(payload):
    totals = {}
    car_totals = {}
    seen = set()
    errors = 0

    def lap_count(text):
        try:
            return max(0, int(text))
        except (TypeError, ValueError):
            return 0

    def positive_seconds(text):
        try:
            seconds = float(text)
            return seconds if math.isfinite(seconds) and seconds > 0 else None
        except (TypeError, ValueError):
            return None

    def add(name, laps, length, track, car, category, durations, first, last):
        key = normalize(name)
        if key in ('', 'a driver'):
            return
        total = totals.setdefault(key, {'id': key, 'name': name.strip(), 'km': 0, 'laps': 0})
        km = laps * length / 1000
        total['km'] += km
        if track and laps:
            tracks = total.setdefault('favouriteTracks', {})
            entry = tracks.setdefault(normalize(track), {'track': track, 'km': 0})
            entry['km'] += km
        if category and laps:
            class_distance = total.setdefault('classDistanceKm', {})
            class_distance[category] = class_distance.get(category, 0) + km
        if car and category and laps:
            entry = car_totals.setdefault((key, category, normalize(car)), {'car': car, 'km': 0})
            entry['km'] += km
        total['laps'] += laps
        recorded = [seconds for number, seconds in durations.items() if first <= number <= last]
        if recorded:
            total['trackSeconds'] = total.get('trackSeconds', 0) + sum(recorded)

    for path in directory(payload.get('results'), '.xml'):
        try:
            if path.stat().st_size > 30_000_000:
                raise ValueError('Results file exceeds 30 MB')
            raw = path.read_bytes()
            fingerprint = hashlib.sha256(raw).digest()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            root = ET.fromstring(raw)
            if root.tag != 'RaceResults':
                root = root.find('.//RaceResults')
            if root is None:
                continue
            length = float(root.findtext('TrackLength', '0'))
            if not math.isfinite(length) or length <= 0:
                raise ValueError('Track length missing')
            track = (root.findtext('TrackVenue') or '').strip() or (root.findtext('TrackCourse') or '').strip()
            for stage in root:
                for driver in stage.findall('Driver'):
                    if driver.findtext('isPlayer') == '0':
                        continue
                    car = (driver.findtext('CarType') or driver.findtext('VehName') or '').strip()
                    category = car_class(driver.findtext('CarClass', ''))
                    lap_rows = driver.findall('Lap')
                    count = lap_count(driver.findtext('Laps'))
                    if driver.find('Laps') is None:
                        count = max((lap_count(lap.get('num')) for lap in lap_rows), default=0)
                    durations = {}
                    for lap in lap_rows:
                        number = lap_count(lap.get('num'))
                        seconds = positive_seconds(lap.text)
                        if seconds is None:
                            splits = [positive_seconds(lap.get(f's{i}')) for i in range(1, 4)]
                            if all(split is not None for split in splits):
                                seconds = sum(splits)
                        if 0 < number <= count and seconds is not None:
                            durations[number] = seconds
                    swaps = []
                    for swap in driver.findall('Swap'):
                        start = lap_count(swap.get('startLap'))
                        end = min(count, lap_count(swap.get('endLap')))
                        if 0 < start <= end and swap.text:
                            swaps.append((start, end, swap.text))
                    if swaps:
                        last = 0
                        for start, end, name in sorted(swaps):
                            first = max(start, last + 1)
                            add(name, max(0, end - first + 1), length, track, car, category, durations, first, end)
                            last = max(last, end)
                    else:
                        add(driver.findtext('Name', ''), count, length, track, car, category, durations, 1, count)
        except (OSError, ValueError, ET.ParseError):
            errors += 1
    ranked = sorted(car_totals.items(), key=lambda item: (-item[1]['km'], item[0]))
    for (driver, category, _), entry in ranked:
        by_class = totals[driver].setdefault('favouriteCars', {})
        favourites = by_class.setdefault(category, [])
        if len(favourites) < 3:
            favourites.append(entry)
    for total in totals.values():
        tracks = total.get('favouriteTracks', {})
        total['favouriteTracks'] = sorted(tracks.values(), key=lambda entry: (-entry['km'], normalize(entry['track'])))
    return {'drivers': sorted(totals.values(), key=lambda row: row['id']), 'errors': errors}


def activation_seconds_by_lap(rows, laps, finish):
    if not rows:
        return {}
    timestamps = [row[0] for row in rows]
    values = {}
    for lap in laps:
        start, end = lap['start'], lap['end']
        duration = 0
        covered = False
        first = max(0, bisect.bisect_right(timestamps, start) - 1)
        for index in range(first, bisect.bisect_left(timestamps, end)):
            timestamp, state, *_ = rows[index]
            until = timestamps[index + 1] if index + 1 < len(rows) else finish
            overlap = min(end, until) - max(start, timestamp)
            if overlap > 0 and state in (0, 1):
                covered = True
                if state == 1:
                    duration += overlap
        if covered:
            values[lap['id']] = duration
    return values


def load_summary_channels(payload):
    laps = payload['laps']
    if not laps:
        return {}
    with db(payload['path']) as con:
        names = {row[0] for row in con.execute('SHOW TABLES').fetchall()}
        sampled = {name: (rate, unit) for name, rate, unit in records(con, 'channelsList')}
        logged_events = dict(records(con, 'eventsList'))
        start, finish = con.execute(
            'SELECT first(value ORDER BY rowid), last(value ORDER BY rowid) FROM "GPS Time"'
        ).fetchone()
        result = {}
        for name in payload['channels']:
            if name not in names or (name not in sampled and name not in logged_events):
                continue
            table = quoted(name)
            columns = [row[0] for row in con.execute(f'DESCRIBE {table}').fetchall() if row[0] != 'ts']
            if not columns:
                continue
            unit = sampled[name][1] if name in sampled else logged_events[name]
            is_peak = name in ('Engine RPM', 'TyresPressure') or (unit or '').strip().casefold() in {'c', '°c', 'f', '°f', 'k'}
            if name in sampled:
                rate, _ = sampled[name]
                numeric = [f'try_cast({quoted(column)} AS DOUBLE)' for column in columns]
                if name == 'Fuel Level':
                    values = consumption_by_lap(con, name, laps, start, rate)
                else:
                    read_values = sampled_lap_peaks if is_peak else sampled_lap_ends
                    values = read_values(con, name, numeric, laps, start, finish, rate)
            else:
                rows = events(con, names, name)
                timestamps = [row[0] for row in rows]
                values = {}
                for lap in laps:
                    index = bisect.bisect_left(timestamps, lap['end']) - 1
                    if index < 0:
                        continue
                    first = index
                    if is_peak:
                        # Include the last reading in effect at the start of the lap.
                        first = max(0, bisect.bisect_right(timestamps, lap['start']) - 1)
                    readings = (v for row in rows[first:index + 1] for v in row[1:]
                                if isinstance(v, (int, float)) and math.isfinite(v))
                    value = max(readings, default=None)
                    if value is not None:
                        values[lap['id']] = int(value) if isinstance(value, bool) else value
            channel = {'unit': unit, 'values': values, 'event': name not in sampled}
            if name == 'TyresPressure' and name in sampled:
                channel['wheelValues'] = [
                    sampled_lap_peaks(con, name, [f'try_cast({quoted(wheel)} AS DOUBLE)'], laps, start, finish, rate)
                    if wheel in columns else {}
                    for wheel in ('value1', 'value2', 'value3', 'value4')
                ]
            if name in ('ABS', 'TC'):
                if name in sampled:
                    rows = [(start + rowid / rate, state) for rowid, state in con.execute(
                        f'SELECT rowid, {quoted(columns[0])} FROM {table} ORDER BY rowid'
                    ).fetchall()] if rate and rate > 0 else []
                    activation_finish = min(finish, rows[-1][0] + 1 / rate) if rows else finish
                else:
                    activation_finish = finish
                channel['activeSeconds'] = activation_seconds_by_lap(rows, laps, activation_finish)
            result[name] = channel
        return result


def lap_track_condition(path_events, off_path_events, start, finish):
    # Include the value already in effect at the start of the lap.
    channels = [path_events, off_path_events]
    positions = [bisect.bisect_right(times, start) for times, _ in channels]
    values = [samples[position - 1] if position else None
              for (_, samples), position in zip(channels, positions)]
    changes = {}
    for channel, ((times, samples), position) in enumerate(zip(channels, positions)):
        end = bisect.bisect_left(times, finish)
        for index in range(position, end):
            changes.setdefault(times[index], {})[channel] = samples[index]

    def classify():
        on, off = values
        if on is None or on < 0:
            return 'unknown'
        if on > 0:
            return 'wet'
        if off is None or off < 0:
            return 'unknown'
        return 'damp' if off > 0 else 'dry'

    conditions = {classify()}
    for timestamp in sorted(changes):
        for channel, value in changes[timestamp].items():
            values[channel] = value
        conditions.add(classify())
    observed = conditions - {'unknown'}
    if len(observed) > 1:
        return 'changing'
    return next(iter(observed)) if observed and 'unknown' not in conditions else 'unknown'


def post_corner_speeds(con, rates, origin, start, finish, exits):
    def samples(channel):
        rate = rates.get(channel)
        if not rate or rate <= 0:
            return [], []
        lo = max(0, math.floor((start - origin) * rate) - 1)
        hi = math.ceil((finish - origin) * rate) + 1
        rows = con.execute(f'SELECT rowid, value FROM {quoted(channel)} '
                           'WHERE rowid BETWEEN ? AND ? ORDER BY rowid', [lo, hi]).fetchall()
        return ([origin + rowid / rate for rowid, _ in rows],
                [finite(value) for _, value in rows])

    brake_times, brake = samples('Brake Pos')
    braking = []
    for i in range(1, len(brake)):
        before, after = brake[i - 1:i + 1]
        span = brake_times[i] - brake_times[i - 1]
        if before is not None and after is not None and before < 5 <= after and 0 < span <= .5:
            crossing = brake_times[i - 1] + span * (5 - before) / (after - before)
            if start <= crossing < finish:
                braking.append(crossing)
    speed_times, speeds = samples('Ground Speed')

    def speed_at(time):
        index = bisect.bisect_left(speed_times, time)
        if index < len(speeds) and speed_times[index] == time:
            return speeds[index]
        if 0 < index < len(speeds) and speeds[index - 1] is not None and speeds[index] is not None:
            fraction = (time - speed_times[index - 1]) / (speed_times[index] - speed_times[index - 1])
            return speeds[index - 1] + fraction * (speeds[index] - speeds[index - 1])
        return None

    maxima = []
    for exit_time in exits:
        index = bisect.bisect_right(braking, exit_time) if exit_time is not None else len(braking)
        if index == len(braking):
            maxima.append(None)
            continue
        end = braking[index]
        if not speed_times or exit_time < speed_times[0] or end > speed_times[-1]:
            maxima.append(None)
            continue
        readings = speeds[bisect.bisect_right(speed_times, exit_time):bisect.bisect_left(speed_times, end)]
        readings.extend((speed_at(exit_time), speed_at(end)))
        maxima.append(max((value for value in readings if value is not None), default=None))
    return maxima


def practice_corner_times(payload):
    corners = payload['corners']
    with db(payload['path']) as con:
        names = {row[0] for row in con.execute('SHOW TABLES').fetchall()}
        rates = {name: rate for name, rate, _ in records(con, 'channelsList') if name in names}
        frequency = rates.get('Lap Dist')
        tyre_rate = rates.get('TyresTempCentre')
        origin = con.execute('SELECT first(value ORDER BY rowid) FROM "GPS Time"').fetchone()[0]
        if origin is None:
            return []
        laps = payload['laps']
        wetness = []
        for name in ('Minimum Path Wetness', 'OffpathWetness'):
            values = [(time, finite(value)) for time, value in events(con, names, name)]
            wetness.append(([time for time, _ in values], [value for _, value in values]))
        tyre_ids = {}
        tyre_samples = {}
        if tyre_rate and tyre_rate > 0:
            for lap in laps:
                first = max(0, math.ceil((lap['start'] - origin) * tyre_rate - 1e-6))
                last = math.ceil((lap['end'] - origin) * tyre_rate - 1e-6) - 1
                if last >= first:
                    tyre_ids[lap['id']] = (first, last)
            ids = sorted({value for pair in tyre_ids.values() for value in pair})
            if ids:
                tyre_samples = {rowid: [finite(value) for value in values]
                                for rowid, *values in con.execute(
                                    'SELECT rowid, value1, value2, value3, value4 FROM "TyresTempCentre" '
                                    'WHERE rowid IN (SELECT unnest(?))', [ids]).fetchall()}
        results = []
        for lap in laps:
            start, finish = lap['start'], lap['end']
            result = {'id': lap['id'], 'times': [],
                      'condition': lap_track_condition(*wetness, start, finish),
                      'tyres': [tyre_samples.get(i) for i in tyre_ids.get(lap['id'], ())]}
            results.append(result)
            if not corners or not frequency or frequency <= 0:
                continue
            lo = max(0, math.floor((start - origin) * frequency) - 1)
            hi = max(lo + 1, math.ceil((finish - origin) * frequency) + 1)
            rows = con.execute('SELECT * FROM "Lap Dist" WHERE rowid BETWEEN ? AND ? ORDER BY rowid',
                               [lo, hi]).fetchall()
            distances, times = [], []
            for index, (distance, *_) in enumerate(rows):
                time = origin + (lo + index) / frequency
                if distance is None or not math.isfinite(distance) or time < start - 1e-6 or time >= finish - 1e-6:
                    continue
                if (time - start < .4 and distance > 1000 or
                        finish - time < .4 and distance < 100 and distances and distances[-1] > 1000):
                    continue
                distances.append(max(distance, distances[-1]) if distances else distance)
                times.append(time)
            if len(distances) < 2 or distances[-1] - distances[0] <= 10:
                continue
            if times[0] > start + 1e-6:
                distances.insert(0, 0)
                times.insert(0, start)
            else:
                distances[0] = 0

            def time_at(distance):
                index = bisect.bisect_left(distances, distance)
                if index == 0 or distances[index] == distance:
                    return times[index]
                fraction = (distance - distances[index - 1]) / (distances[index] - distances[index - 1])
                return times[index - 1] + fraction * (times[index] - times[index - 1])

            exits = [time_at(end) if 0 <= begin < end <= distances[-1] else None for begin, end in corners]
            result['times'] = [
                exit_time - time_at(begin) if exit_time is not None else None
                for (begin, _), exit_time in zip(corners, exits)
            ]
            result['postCornerSpeeds'] = post_corner_speeds(con, rates, origin, start, finish, exits)
        return results


def load_lap(payload):
    start, finish = payload['start'], payload['end']
    with db(payload['path']) as con:
        clock_start = con.execute('SELECT first(value ORDER BY rowid) FROM "GPS Time"').fetchone()[0]
        channel_list = records(con, 'channelsList')
        event_list = records(con, 'eventsList')
        channels = {}
        names = {row[0] for row in con.execute('SHOW TABLES').fetchall()}
        for name, frequency, unit in channel_list:
            if name not in names or not frequency or frequency <= 0:
                continue
            lo = max(0, math.floor((start - clock_start) * frequency) - 1)
            hi = max(lo + 1, math.ceil((finish - clock_start) * frequency) + 1)
            rows = con.execute(f'SELECT * FROM {quoted(name)} WHERE rowid BETWEEN ? AND ? ORDER BY rowid',
                               [lo, hi]).fetchall()
            channels[name] = dict(unit=unit, rate=frequency, origin=clock_start + lo / frequency,
                                  rows=[[finite(value) for value in row] for row in rows])
        for name, unit in event_list:
            if name not in names:
                continue
            table = quoted(name)
            rows = con.execute(f'''SELECT * FROM {table} WHERE ts BETWEEN ? AND ?
                OR rowid = (SELECT rowid FROM {table} WHERE ts < ? ORDER BY ts DESC, rowid DESC LIMIT 1)
                ORDER BY ts, rowid''', [start, finish, start]).fetchall()
            channels[name] = dict(unit=unit, rows=[[finite(value) for value in row] for row in rows])
    return channels


def export_lap(payload):
    destination = Path(payload['destination'])
    if destination.suffix.lower() != '.zip':
        raise ValueError('Choose a .zip filename for the export.')
    channels = load_lap(payload)
    start, finish = payload['start'], payload['end']

    def csv_cell(value):
        # Prevent recorded text from being interpreted as a spreadsheet formula.
        return "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value

    metadata = [csv_cell(payload[key]) for key in ('track', 'car', 'lap', 'time', 'validity')]
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.tmp', dir=destination.parent, delete=False) as file:
            temporary = Path(file.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive, \
                archive.open(destination.with_suffix('.csv').name, 'w') as member, \
                io.TextIOWrapper(member, encoding='utf-8-sig', newline='') as file:
            writer = csv.writer(file)
            writer.writerow(['track', 'car', 'lap', 'lap_time_s', 'validity', 'elapsed_s', 'channel',
                             'unit', 'component', 'value', 'sample_rate_hz', 'car_class', 'driver', 'track_name', 'track_layout', 'game_version'])
            for name, channel in channels.items():
                rate = channel.get('rate')
                for index, row in enumerate(channel['rows']):
                    if rate:
                        time, values = channel['origin'] + index / rate, row
                        if time < start - 1e-6:
                            continue
                    else:
                        time, *values = row
                    if time >= finish - 1e-6:
                        break
                    elapsed = round(max(0, time - start), 6)
                    prefix = [*metadata, elapsed, csv_cell(name), csv_cell(channel['unit'])]
                    for component, value in enumerate(values, 1):
                        writer.writerow([*prefix, component, csv_cell(value), rate, csv_cell(payload.get('carClass', '')), csv_cell(payload.get('driver', '')),
                                         *(csv_cell(payload.get(key) or '') for key in ('trackName', 'trackLayout', 'gameVersion'))])
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {'saved': True}


@contextmanager
def open_comparison_lap(path):
    if path.stat().st_size > 200_000_000:
        raise ValueError('Choose a Total Telemetry ZIP under 200 MB.')
    if path.suffix.lower() == '.csv':
        # Earlier app versions stored imported laps as plain CSV in app data.
        with path.open(encoding='utf-8-sig', newline='') as file:
            yield file
        return
    if path.suffix.lower() != '.zip':
        raise ValueError('Choose a Total Telemetry ZIP.')
    try:
        with zipfile.ZipFile(path) as archive:
            members = [entry for entry in archive.infolist()
                       if not entry.is_dir() and Path(entry.filename).suffix.lower() == '.csv']
            if len(members) != 1:
                raise ValueError('The ZIP must contain exactly one lap CSV.')
            if members[0].file_size > 512 * 1024 * 1024:
                raise ValueError('The lap CSV exceeds 512 MiB when expanded from the ZIP.')
            with archive.open(members[0]) as member, io.TextIOWrapper(member, encoding='utf-8-sig', newline='') as file:
                yield file
    except zipfile.BadZipFile as error:
        raise ValueError('This is not a readable Total Telemetry ZIP.') from error


def import_comparison_lap(payload):
    path = Path(payload['path'])

    def numeric(text):
        try:
            value = float(text)
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None

    channels = {} if payload.get('includeChannels') else None
    last_samples = {}
    fields = ('track', 'car', 'lap', 'lap_time_s', 'validity')
    required = {*fields, 'elapsed_s', 'channel', 'unit', 'component', 'value'}
    with open_comparison_lap(path) as file:
        reader = csv.DictReader(file)
        if not required <= set(reader.fieldnames or ()):
            raise ValueError('This is not a Total Telemetry lap CSV.')
        first = next(reader, None)
        if not first:
            raise ValueError('This CSV contains no lap telemetry.')
        metadata = tuple(first[key] for key in fields)
        track, car, lap, lap_time, validity = metadata
        duration = numeric(lap_time)
        if not track or not car or duration is None or duration <= 0:
            raise ValueError('This CSV is missing the track, car or lap time.')
        try:
            number = int(lap) if lap else None
        except ValueError:
            raise ValueError('The exported lap number is invalid.') from None
        end = duration
        for row in chain([first], reader):
            if tuple(row[key] for key in fields) != metadata:
                raise ValueError('A comparison CSV must contain one lap.')
            time = numeric(row['elapsed_s'])
            component = numeric(row['component'])
            name = row['channel']
            if time is None or time < 0 or component is None or not component.is_integer() or not 1 <= component <= 16 or not name:
                raise ValueError('The CSV contains invalid telemetry samples.')
            end = max(end, time + .000001)
            previous_time, previous_component = last_samples.get(name, (-1, 0))
            new_sample = time != previous_time or component == 1
            if new_sample and time < previous_time:
                raise ValueError('The CSV samples are out of order.')
            if component != (1 if new_sample else previous_component + 1):
                raise ValueError('The CSV telemetry components are out of order.')
            last_samples[name] = (time, component)
            if channels is not None:
                channel = channels.get(name)
                if channel is None:
                    rate = numeric(row.get('sample_rate_hz'))
                    channel = channels[name] = {'unit':row['unit'], 'rows':[]}
                    if rate and rate > 0:
                        channel.update(rate=rate, origin=time)
                rows = channel['rows']
                if new_sample:
                    rows.append([] if 'rate' in channel else [time])
                text = row['value']
                value = {'True': True, 'False': False}.get(text, numeric(text))
                rows[-1].append(text if value is None and text else value)
    if 'Lap Dist' not in last_samples:
        raise ValueError('This CSV has no lap-distance data for comparison.')
    result = {'track':track, 'car':car, 'driver':first.get('driver') or '', 'carClass':car_class(first.get('car_class') or ''),
              'trackName':first.get('track_name') or track, 'trackLayout':first.get('track_layout') or track,
              'gameVersion':first.get('game_version') or '',
              'lap':{'id':0, 'number':number, 'time':duration, 'validity':validity,
                     'start':0, 'end':end, 'kind':'complete'}}
    if channels is not None:
        result['channels'] = channels
    return result


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        payload = json.loads(sys.stdin.buffer.read())
        result = {'index': index, 'lap': load_lap, 'summary': load_summary_channels, 'results-distance': results_distance, 'practice-corners': practice_corner_times, 'export-lap': export_lap, 'import-comparison-lap': import_comparison_lap}[command](payload)
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=True, allow_nan=False,
                                           separators=(',', ':')).encode('ascii'))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
