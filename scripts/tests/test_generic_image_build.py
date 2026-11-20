"""Guard the hosted image workflow's build-only boundary."""

import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/build-images.yml"
CI_WORKFLOW = WORKFLOW.with_name("ci.yml")
SERVICES = {"backend", "backoffice", "portal", "ai-service"}


class GenericImageBuildTest(unittest.TestCase):
    def test_existing_ci_is_reusable_without_losing_its_triggers(self):
        ci = CI_WORKFLOW.read_text()
        self.assertRegex(ci, r"(?m)^  workflow_call:\s*$")
        self.assertRegex(ci, r"(?m)^  pull_request:\s*$")
        self.assertRegex(ci, r"(?m)^  push:\s*$")

    def test_frontends_require_configured_public_build_urls(self):
        workflow = WORKFLOW.read_text()
        self.assertIn("BUILD_API_URL: ${{ vars.EDGEOS_DEV_API_URL }}", workflow)
        self.assertIn(
            "BUILD_PORTAL_DOMAIN: ${{ vars.EDGEOS_DEV_PORTAL_DOMAIN }}", workflow
        )
        self.assertIn("name: Validate public build URLs", workflow)
        self.assertIn("VITE_API_URL=${{ env.BUILD_API_URL }}", workflow)
        self.assertIn("VITE_PORTAL_DOMAIN=${{ env.BUILD_PORTAL_DOMAIN }}", workflow)
        self.assertIn("NEXT_PUBLIC_API_URL=${{ env.BUILD_API_URL }}", workflow)
        self.assertNotIn("VITE_API_URL=http://localhost", workflow)
        self.assertNotIn("NEXT_PUBLIC_API_URL=http://localhost", workflow)

    def test_public_build_url_validation_refuses_missing_or_local_values(self):
        workflow = WORKFLOW.read_text()
        script = textwrap.dedent(
            workflow.split(
                "      - name: Validate public build URLs\n        run: |\n", 1
            )[1].split("\n      - ", 1)[0]
        )
        cases = (
            ("", "", 1),
            ("http://localhost:8000", "dev.example.org", 1),
            ("https://api.example.org", "localhost:3000", 1),
            ("https://localhost.", "dev.example.org", 1),
            ("https://api.example.org", "localhost.", 1),
            ("https://api.example.org:bad", "dev.example.org", 1),
            ("https://api.example.org", "dev.example.org:bad", 1),
            ("https://api.example.org", "dev.example.org", 0),
        )
        with tempfile.TemporaryDirectory(
            dir=os.environ.get("TMPDIR", "/tmp/opencode")
        ) as directory:
            for api, portal, expected in cases:
                with self.subTest(api=api, portal=portal):
                    result = subprocess.run(
                        ["bash", "-eu", "-c", script],
                        cwd=directory,
                        env={
                            "PATH": "/usr/bin:/bin",
                            "BUILD_API_URL": api,
                            "BUILD_PORTAL_DOMAIN": portal,
                        },
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode, expected, result.stderr)
                    if expected:
                        self.assertEqual(
                            result.stderr,
                            "Valid public dev API URL and portal domain are required\n",
                        )

    def test_each_publication_rechecks_dev_head(self):
        text = WORKFLOW.read_text()
        steps = re.split(r"(?m)^      - (?=(?:id:|name:|uses:))", text)
        builds = [step for step in steps if "uses: docker/build-push-action@" in step]
        self.assertEqual(len(builds), 4)
        for step in builds:
            self.assertIn("push: false", step)
            self.assertIn("load: true", step)
        pushes = [i for i, step in enumerate(steps) if 'docker push "$image"' in step]
        self.assertEqual(len(pushes), 4)
        for i in pushes:
            self.assertIn("Refuse stale dev revision before publication", steps[i - 1])

    def test_build_only_manifest_handoff(self):
        text = WORKFLOW.read_text()
        self.assertIn("  push:\n    branches: [dev]", text)
        self.assertNotIn("workflow_dispatch", text)
        self.assertEqual(
            set(re.findall(r"^  ([\w-]+):\n", text, re.M)),
            {"checks", "boundary", "build", "push"},
        )
        self.assertEqual(
            text.count("vars.EDGEOS_DEV_IMAGE_PUBLISH_ENABLED == 'true'"), 3
        )
        for name in ("checks", "boundary", "build"):
            self.assertRegex(
                text,
                rf"(?m)^  {name}:\n(?:    needs: [^\n]+\n)?"
                r"    if: vars\.EDGEOS_DEV_IMAGE_PUBLISH_ENABLED == 'true'",
            )
        self.assertIn("needs: [checks, boundary]", text)
        self.assertIn("packages: write", text)
        for forbidden in (
            "ssh ",
            "HETZNER_",
            "deploy.py",
            "workflow.py",
            "alembic",
            "initial_data",
        ):
            self.assertNotIn(forbidden, text)
        for service in SERVICES:
            self.assertIn(f"- id: {service}", text)
            self.assertIn(f"steps.publish-{service}.outputs.digest", text)
            self.assertIn(f"-{service}:${{{{ github.sha }}}}", text)
        self.assertEqual(text.count("push: false"), 4)
        self.assertEqual(text.count("actions/upload-artifact@"), 1)
        self.assertIn("name: image-digests", text)
        self.assertIn("if-no-files-found: error", text)
        self.assertIn("name: Write digest manifest", text)
        self.assertIn("SHA: ${{ github.sha }}", text)
        for service in SERVICES:
            self.assertIn(
                f"{service.upper().replace('-', '_')}_DIGEST: ${{{{ steps.publish-{service}.outputs.digest }}}}",
                text,
            )


if __name__ == "__main__":
    unittest.main()
