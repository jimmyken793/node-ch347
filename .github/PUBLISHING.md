# GitHub Actions & npm Publishing Setup

This repository has automated CI/CD workflows configured for building and publishing the package to npm.

## Workflows

### CI Workflow ([ci.yml](.github/workflows/ci.yml))
- **Triggers**: On push to `main` branch and all pull requests
- **Purpose**: Build and test the package across multiple platforms and Node.js versions
- **Platforms**: Ubuntu, macOS, Windows
- **Node.js versions**: 18.x, 20.x, 22.x
- **Steps**:
  - Install dependencies
  - Build TypeScript
  - Run tests (continues on error since tests require physical hardware)
  - Type check with TypeScript

### Publish Workflow ([publish.yml](.github/workflows/publish.yml))
- **Triggers**:
  - Automatically when a new GitHub release is created
  - Manually via workflow_dispatch
- **Purpose**: Build and publish the package to npm with provenance
- **Steps**:
  - Install dependencies
  - Build TypeScript
  - Publish to npm with provenance attestation

## Setup Instructions

### 1. Configure npm Token

To enable automated publishing, you need to configure an npm access token:

1. **Create an npm access token**:
   - Go to [https://www.npmjs.com](https://www.npmjs.com) and log in
   - Navigate to your account settings → Access Tokens
   - Click "Generate New Token" → "Automation" (or "Classic" with automation permissions)
   - Copy the generated token

2. **Add the token to GitHub Secrets**:
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm access token
   - Click "Add secret"

### 2. Publishing a New Version

There are two ways to publish a new version:

#### Option A: Using GitHub Releases (Recommended)
1. Update version in [package.json](package.json):
   ```bash
   npm version patch  # or minor/major
   ```

2. Push the version commit and tag:
   ```bash
   git push && git push --tags
   ```

3. Create a GitHub release:
   - Go to your repository on GitHub
   - Click "Releases" → "Create a new release"
   - Select the tag you just pushed
   - Fill in release notes
   - Click "Publish release"

4. The publish workflow will automatically trigger and publish to npm

#### Option B: Manual Trigger
1. Update version in [package.json](package.json)
2. Commit and push changes
3. Go to Actions → "Publish to npm" workflow
4. Click "Run workflow" → Select branch → "Run workflow"

## npm Provenance

The publish workflow is configured with npm provenance, which provides:
- Transparency about where and how the package was built
- Cryptographic attestation linking the published package to its source code
- Enhanced supply chain security

This is enabled via the `--provenance` flag and requires the `id-token: write` permission.

## Troubleshooting

### Build fails on CI
- Check that all dependencies are properly listed in [package.json](package.json)
- Ensure TypeScript compiles without errors locally
- Review the CI logs for specific error messages

### Publish fails
- Verify the `NPM_TOKEN` secret is correctly configured
- Ensure your npm account has publishing rights to the `node-ch347` package
- Check that the version in [package.json](package.json) hasn't already been published
- Review the publish workflow logs for specific errors

### Tests fail on CI
- This is expected since tests require physical CH347 hardware
- Tests are configured to `continue-on-error: true` and won't fail the build
- Consider adding unit tests that don't require hardware for CI validation
