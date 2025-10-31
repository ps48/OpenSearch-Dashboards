# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

OpenSearch Dashboards is a browser-based data visualization and exploration tool for OpenSearch. It's built on Node.js (v18.19.0) using React and TypeScript, providing analytics and search capabilities through a plugin-based architecture.

**Prerequisites:**
- Node.js v18.19.0 (specified in `.nvmrc`)
- Yarn v1.22.10+
- Running OpenSearch instance (for most development tasks)

## Key Development Commands

### Initial Setup
```bash
# Install dependencies and build internal packages
yarn osd bootstrap

# If network timeout issues occur
yarn osd bootstrap --network-timeout 1000000

# Clean build artifacts and dependencies
yarn osd clean
```

### Running OpenSearch Dashboards
```bash
# Start OpenSearch backend (required)
yarn opensearch snapshot

# Start Dashboards development server
yarn start

# Start with security plugin enabled
yarn start:security

# Start with explore features and query enhancements
yarn start:explore

# Start with query enhancements enabled
yarn start:enhancements

# Debug mode
yarn debug

# Debug mode with breakpoint on start
yarn debug-break
```

### Testing
```bash
# Run all tests
yarn test

# Unit tests
yarn test:jest                         # Run all unit tests
yarn test:jest [path]                   # Run specific tests
yarn test:jest [path] --maxWorkers=2    # Run with limited workers (useful for debugging)
yarn test:jest:coverage                 # With coverage report

# Integration tests
yarn test:jest_integration              # Run all integration tests
yarn test:jest_integration [path]       # Run specific integration tests
yarn test:jest_integration [path] --maxWorkers=2  # Run with limited workers

# Functional tests (Cypress)
yarn cypress:run-without-security       # Run without security
yarn cypress:run-with-security          # Run with security
yarn cypress open                       # Open Cypress GUI

# Type checking
yarn typecheck

# Linting
yarn lint                               # Run all linters
yarn lint:es                           # ESLint only
yarn lint:style                        # Stylelint only
```

### Building
```bash
# Build for production
yarn build                              # All platforms
yarn build-platform                     # Current platform only

# Generate types
yarn build:types

# API documentation
yarn docs:acceptApiChanges              # Accept API changes
yarn docs:generateDevDocs               # Generate documentation
```

## High-Level Architecture

### Core Systems
The platform is built on a **Core** system (`src/core/`) that provides fundamental services:

- **Frontend Core** (`src/core/public/`): Manages the browser-side application lifecycle, plugin loading, chrome UI, and core services like HTTP, saved objects, and notifications
- **Backend Core** (`src/core/server/`): Handles server-side operations, HTTP routing, OpenSearch client connections, saved objects management, and plugin lifecycle
- **Plugin System**: Both frontend and backend support dynamic plugin loading with defined contracts and lifecycle hooks

### Plugin Architecture
Plugins are the primary way to extend OpenSearch Dashboards functionality:

- **Location**: Core plugins in `src/plugins/`, additional plugins can be in `plugins/` directory
- **Structure**: Each plugin has `public/` (frontend), `server/` (backend), and `common/` (shared) directories
- **Lifecycle**: Plugins go through setup → start → stop phases with dependency management
- **Key Plugins**:
  - `data`: Manages queries, search, and index patterns
  - `discover`: Data exploration interface
  - `dashboard`: Dashboard creation and visualization
  - `visualizations`: Chart and visualization rendering
  - `expressions`: Expression language for data processing
  - `embeddable`: Framework for embedding visualizations

### Data Flow
1. **OpenSearch Connection**: Backend core maintains OpenSearch client connections
2. **Data Plugin**: Abstracts search and query operations
3. **Index Patterns**: Define how data is accessed and field mappings
4. **Saved Objects**: System for storing dashboards, visualizations, and other configurations
5. **Expressions**: Pipeline-based data processing and transformation

### UI Framework
- **React**: Primary UI framework with hooks and functional components
- **EUI (Elastic UI)**: Component library for consistent UI elements
- **OUI (OpenSearch UI)**: OpenSearch-specific UI components
- **State Management**: Uses React context, Redux in legacy code
- **Routing**: Client-side routing with hash-based navigation

### Build System
- **Webpack**: Module bundling with @osd/optimizer
- **TypeScript**: Full TypeScript support with strict typing
- **Babel**: JavaScript transpilation
- **Jest**: Unit and integration testing
- **Cypress**: End-to-end testing

### Configuration
- **opensearch_dashboards.yml**: Main configuration file
- **Environment Variables**: Runtime configuration options
- **Plugin Configs**: Each plugin can define its own configuration schema

## Testing Strategy

### Test Types and Coverage Requirements
- **Unit Tests**: Required for all logic, 80%+ coverage enforced via Codecov
- **Integration Tests**: For API and service interactions
- **Functional Tests**: Critical user workflows using Cypress
- **Performance Tests**: Lighthouse-based metrics for critical pages

### Best Practices
- Place test files next to source files with `.test.ts` extension
- Use React Testing Library for component tests
- Mock external dependencies and services
- Avoid snapshot testing for React components
- Write Cypress tests in `cypress/integration/` directory

## Important Conventions

### Code Style
- TypeScript for all new code
- Follow existing patterns in neighboring files
- Use existing libraries and utilities rather than creating new ones
- Check imports and dependencies before adding new packages

### File Organization
- Group related functionality in plugins
- Keep public/server/common separation clear
- Use barrel exports (index.ts) for clean imports
- **All filenames use `snake_case`** (e.g., `index_pattern.ts`, not `IndexPattern.ts`)
- Place test files next to source files with `.test.ts` or `.test.tsx` extension
- Import SASS files at the top of component files: `import './component.scss';`

### API Development
- RESTful endpoints under `/api/` namespace
- Use OpenSearch Dashboards's validation schemas
- Handle errors consistently
- Document API changes in public API files

### Security
- Never commit secrets or API keys
- Use OpenSearch Dashboards's built-in security features
- Validate all user inputs
- Follow OWASP guidelines for web security

## Common Development Tasks

### Creating a New Plugin
Use the plugin generator:
```bash
node scripts/generate_plugin
# or
yarn osd bootstrap  # if adding an external plugin to plugins/ directory
```

### When to Run Bootstrap
Run `yarn osd bootstrap` when you:
- Clone the repository for the first time
- Switch branches (especially if package.json or dependencies changed)
- Pull changes that modify dependencies or internal packages
- Add or remove plugins
- Encounter "module not found" errors after pulling changes

### Working with Saved Objects
- Define types in `server/saved_objects/`
- Use migrations for schema changes
- Handle backward compatibility

### Debugging
- Use Chrome DevTools for frontend debugging
- Attach debugger to Node.js on port 9229 for backend
- Check logs in terminal and browser console

### Performance Optimization
- Use React.memo and useMemo for expensive computations
- Implement virtual scrolling for large lists
- Lazy load plugins and components
- Monitor bundle sizes with `yarn analyze`

## Troubleshooting Common Issues

### Network Timeout During Bootstrap
If you encounter network timeouts during `yarn osd bootstrap`:
```bash
yarn osd bootstrap --network-timeout 1000000
```

### Memory Issues with Docker/OpenSearch
If OpenSearch fails to start with memory errors:
```bash
# Linux/Mac
sudo sysctl -w vm.max_map_count=262144

# Windows (in WSL)
wsl -d docker-desktop
sysctl -w vm.max_map_count=262144
```

### Clean Build Issues
If you encounter strange build errors after switching branches:
```bash
yarn osd clean
yarn osd bootstrap
```

### Test Failures
- For flaky tests, try running with `--maxWorkers=2` to reduce concurrency
- Check if OpenSearch is running and accessible before running integration tests
- Ensure you're using the correct Node version (check with `node --version`)

## Development Tips

- Run `yarn osd bootstrap` after pulling changes or switching branches
- Use `yarn start` for development with hot reloading
- Always ensure OpenSearch is running before starting Dashboards
- Check `DEVELOPER_GUIDE.md` for detailed setup instructions
- Review `TESTING.md` for comprehensive testing guidelines
- See `CONTRIBUTING.md` before submitting pull requests
- Use `nvm use` to switch to the correct Node version (from `.nvmrc`)