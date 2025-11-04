# SQL Server Profiler Tool - Release Preparation Guide

## Prerequisites for VS Code Marketplace Publishing

### 1. Install VSCE (VS Code Extension Manager)
```bash
npm install -g vsce
```

### 2. Create Publisher Account
- Go to https://marketplace.visualstudio.com/manage
- Sign in with Microsoft account
- Create publisher profile (if not exists)

### 3. Get Personal Access Token
- Go to https://dev.azure.com/[your-org]/_usersSettings/tokens
- Create token with "Marketplace (publish)" scope
- Save token securely

## Release Checklist

### ✅ Pre-Release Verification
- [ ] Version updated in package.json (current: 0.2.0)
- [ ] CHANGELOG.md updated with new features
- [ ] README.md contains accurate installation/usage instructions
- [ ] All TypeScript files compile without errors
- [ ] Extension tested in development environment
- [ ] All new features documented

### ✅ Files Ready
- [ ] LICENSE file created
- [ ] .vscodeignore configured
- [ ] Icon file (128x128 PNG recommended)
- [ ] Repository URL in package.json
- [ ] Keywords optimized for search

### ✅ Package Commands

1. **Test compilation:**
   ```bash
   npm run compile
   ```

2. **Package extension (creates .vsix file):**
   ```bash
   vsce package
   ```

3. **Publish to marketplace:**
   ```bash
   vsce publish
   ```

4. **Publish specific version:**
   ```bash
   vsce publish 0.2.0
   ```

### ✅ Release Notes Template

Copy this for the release:

```markdown
# 🚀 SQL Server Profiler Tool v0.2.0

## Major Usability Improvements
- **Persistent Expanded State**: Events remain expanded during real-time capture
- **Connection Pool Management**: Intelligent connection reuse for better performance  
- **Scroll Position Preservation**: View stays stable during live updates

## Technical Enhancements
- Unique event IDs for stable state tracking
- Auto-correction for Azure SQL server formats
- Health checks and connection validation
- Memory-optimized event management

## Bug Fixes
- Fixed boolean type errors in connection configuration
- Resolved ENOTFOUND errors with malformed server names
- Eliminated event detail collapse during capture

## Impact
- 100% improvement in troubleshooting workflow
- Real-time analysis without interruption
- Professional-grade SQL Server monitoring in VS Code
```

## Post-Release Steps

1. **Verify Publication:**
   - Check extension appears in marketplace
   - Test installation from marketplace
   - Verify all features work in clean environment

2. **Update Documentation:**
   - Update README with marketplace install instructions
   - Create GitHub release with changelog
   - Update project documentation

3. **Community:**
   - Announce on relevant forums/social media
   - Gather initial user feedback
   - Monitor for issues/bug reports

## Troubleshooting

### Common Issues:
- **"Publisher not found"**: Create publisher account first
- **"Invalid token"**: Regenerate PAT with correct scopes
- **"Icon not found"**: Add icon.png (128x128) to root
- **"Files too large"**: Check .vscodeignore excludes dev files

### Support:
- VS Code Publishing: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- VSCE Documentation: https://github.com/microsoft/vscode-vsce