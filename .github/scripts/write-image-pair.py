#!/usr/bin/env python3
"""Record a deployable image pair only after both registry pushes succeed."""
import json
import os
from pathlib import Path
import re


def write_pair(env):
    revision = env['GITHUB_SHA']
    if not re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', revision):
        raise ValueError('Invalid Git revision')
    images = {}
    for name, repository_key, digest_key in [
        ('API_IMAGE', 'API_IMAGE_REPOSITORY', 'API_DIGEST'),
        ('FIELD_WORKER_IMAGE', 'WORKER_IMAGE_REPOSITORY', 'WORKER_DIGEST'),
    ]:
        repository, digest = env[repository_key], env[digest_key]
        if not re.fullmatch(r'[a-z0-9][a-z0-9._/-]*', repository):
            raise ValueError('Invalid image repository: ' + repository_key)
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise ValueError('Missing or invalid build digest: ' + digest_key)
        images[name] = repository + '@' + digest

    run_url = '{}/{}/actions/runs/{}'.format(
        env['GITHUB_SERVER_URL'], env['GITHUB_REPOSITORY'], env['GITHUB_RUN_ID'])
    release = {'schemaVersion': 1, 'revision': revision, 'runUrl': run_url, **images}
    directory = Path(env['IMAGE_PAIR_DIR'])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'image-pair.json').write_text(json.dumps(release, indent=2) + '\n')
    dotenv = ''.join(f'{name}={image}\n' for name, image in images.items())
    (directory / 'image-pair.env').write_text(dotenv)
    summary = env.get('GITHUB_STEP_SUMMARY')
    if summary:
        with Path(summary).open('a') as output:
            output.write(f'### API + Bun field worker\n\nRevision: `{revision}`\n\n')
            output.write('```dotenv\n' + dotenv + '```\n\n')
            output.write('Use this pair together. Publication does not deploy or apply migrations.\n')
    return release


if __name__ == '__main__':
    write_pair(os.environ)
