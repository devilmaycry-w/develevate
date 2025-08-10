# DevElevate Development Workflow

## 🚀 Development & Testing Process

### 1. Local Development
```bash
# Make changes to your extension
# Test locally by pressing F5 in VS Code
# This opens a new Extension Development Host window
```

### 2. Version Management
```bash
# Update version in package.json
# Follow semantic versioning: 1.0.0 -> 1.0.1 (patch), 1.1.0 (minor), 2.0.0 (major)
```

### 3. Testing New Features
```bash
# Press F5 to test in development mode
# OR
# Package locally: vsce package
# Install locally: code --install-extension develevate-1.0.1.vsix
```

### 4. Git Workflow
```bash
git add .
git commit -m "Add new feature: describe what you added"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

### 5. Publishing Updates
```bash
# Option A: Automatic (via GitHub Actions)
git push origin v1.0.1  # Triggers auto-publish

# Option B: Manual
vsce publish --pat YOUR_TOKEN

# Option C: Patch/Minor/Major shortcuts
vsce publish patch  # 1.0.0 -> 1.0.1
vsce publish minor  # 1.0.0 -> 1.1.0
vsce publish major  # 1.0.0 -> 2.0.0
```

## 🎯 Quick Commands

### Testing
- `F5` - Test extension in development mode
- `Ctrl+Shift+F5` - Restart extension development host
- `Ctrl+Shift+P` > "Developer: Reload Window" - Reload extension

### Publishing
- `vsce package` - Create .vsix file for testing
- `vsce publish` - Publish to marketplace
- `vsce publish --pat TOKEN` - Publish with specific token

### Git
- `git status` - Check changes
- `git add .` - Stage all changes
- `git commit -m "message"` - Commit changes
- `git push` - Push to GitHub
