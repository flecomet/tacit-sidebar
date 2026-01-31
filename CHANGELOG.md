# Changelog

All notable changes to Tacit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-31

### Added

- **Saved Prompts Shortcuts** - Save frequently used prompts and quickly insert them using the `/` command
  - Bookmark icon on user messages to save as prompt
  - Type `/` in chat to open prompt picker
  - Filter, navigate with arrow keys, select with Enter
  - Prompts persist locally using encrypted storage

## [1.0.2] - 2026-01-24

### Performance

- **Remove double encryption from storage adapter** - API keys are already encrypted at the application layer. The storage adapter was redundantly encrypting the entire state on every change, causing 30+ encryption calls during provider switching.

- **Add in-memory caching for model lists** - Model lists now cache for 5 minutes, keyed by provider + baseUrl + apiKey indicator. This fixes the ~1s lag when switching providers by returning cached results instead of making network requests on every provider change.

- **Optimize encryption utility** - CryptoKey is now cached in memory after first load, preventing repeated expensive calls to `chrome.storage.local.get` and `crypto.subtle.importKey` that were causing UI lag (high INP) when switching providers or loading chat history.

### Testing

- **Add performance test suite** - New `src/test/performance.test.jsx` with 12 tests measuring provider switching, model selection, encryption performance (cold/warm cache), and combined workflow tests. Configurable thresholds for regression detection.

### Dependencies

- Bump `@testing-library/react` from 16.3.1 to 16.3.2

## [1.0.1] - 2026-01-18

Initial public release with web search feature.

