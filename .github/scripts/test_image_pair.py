import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('image_pair', Path(__file__).with_name('write-image-pair.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImagePairTests(unittest.TestCase):
    def environment(self, root):
        return dict(GITHUB_SHA='a' * 40, GITHUB_SERVER_URL='https://github.com',
                    GITHUB_REPOSITORY='example/api', GITHUB_RUN_ID='123',
                    API_IMAGE_REPOSITORY='example/api', WORKER_IMAGE_REPOSITORY='example/worker',
                    API_DIGEST='sha256:' + '1' * 64, WORKER_DIGEST='sha256:' + '2' * 64,
                    IMAGE_PAIR_DIR=str(root / 'pair'), GITHUB_STEP_SUMMARY=str(root / 'summary.md'))

    def test_writes_matching_digest_references_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = self.environment(root)
            release = module.write_pair(env)
            self.assertEqual(json.loads((root / 'pair/image-pair.json').read_text()), release)
            self.assertEqual(release['revision'], env['GITHUB_SHA'])
            self.assertEqual(release['API_IMAGE'], 'example/api@' + env['API_DIGEST'])
            self.assertEqual(release['FIELD_WORKER_IMAGE'], 'example/worker@' + env['WORKER_DIGEST'])
            self.assertEqual((root / 'pair/image-pair.env').read_text().count('\n'), 2)
            self.assertIn(release['FIELD_WORKER_IMAGE'], (root / 'summary.md').read_text())

    def test_refuses_incomplete_or_invalid_pair_before_writing(self):
        for key, value in [('API_DIGEST', ''), ('WORKER_DIGEST', ''),
                           ('WORKER_DIGEST', 'latest'), ('GITHUB_SHA', 'master'),
                           ('WORKER_IMAGE_REPOSITORY', 'invalid\nINJECT=value')]:
            with self.subTest(key=key, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env = self.environment(root)
                env[key] = value
                with self.assertRaises(ValueError):
                    module.write_pair(env)
                self.assertFalse((root / 'pair').exists())


if __name__ == '__main__':
    unittest.main()
