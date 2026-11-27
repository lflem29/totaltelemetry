"""Keep three stable GitHub releases per Total Telemetry edition."""
import argparse
import json
import re
import subprocess

EDITION_PREFIXES = {
    'lflem29/totaltelemetry': ('v', 'community-server-v'),
    'lflem29/totaltelemetrytpr': ('tpr-v', 'community-server-tpr-v'),
}
VERSION = r'(\d+)\.(\d+)\.(\d+)'


def releases_to_prune(releases, prefixes, published_tag):
    for prefix in prefixes:
        pattern = re.compile(re.escape(prefix) + VERSION)
        if pattern.fullmatch(published_tag):
            break
    else:
        raise ValueError(f'Unsupported release tag: {published_tag}')

    ordered = []
    for release in releases:
        tag = release['tag_name']
        match = pattern.fullmatch(tag)
        if match and not release['draft'] and not release['prerelease']:
            ordered.append((tuple(map(int, match.groups())), tag, release['assets']))
    ordered.sort(reverse=True)
    keep, prune = ordered[:3], ordered[3:]
    if not any(tag == published_tag and any(asset['state'] == 'uploaded' and asset['size'] > 0
                                            for asset in assets) for _, tag, assets in keep):
        raise ValueError(f'{published_tag} must be one of the three newest releases with an uploaded asset.')
    return [tag for _, tag, _ in keep], [tag for _, tag, _ in prune]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', choices=EDITION_PREFIXES, required=True)
    parser.add_argument('--published-tag', required=True)
    parser.add_argument('--apply', action='store_true', help='Delete older releases and keep their Git tags.')
    args = parser.parse_args()

    documents = subprocess.check_output(
        ['gh','api','--paginate',f'repos/{args.repo}/releases?per_page=100',
         '--jq','.[] | {tag_name,draft,prerelease,assets:[.assets[] | {state,size}]}'], text=True)
    releases = [json.loads(line) for line in documents.splitlines()]
    keep, prune = releases_to_prune(releases,EDITION_PREFIXES[args.repo],args.published_tag)
    print('Keep: ' + ', '.join(keep), flush=True)
    print(('Delete: ' if args.apply else 'Would delete: ') + (', '.join(prune) or 'none'), flush=True)
    if args.apply:
        for tag in prune:
            subprocess.run(['gh','release','delete',tag,'--repo',args.repo,'--yes'],check=True)


if __name__ == '__main__':
    main()
