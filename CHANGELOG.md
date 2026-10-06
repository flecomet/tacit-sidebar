# Changelog

All notable changes to Tacit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-10-06

### Added

- **Multiple API keys per provider** - Each key has a label; OpenRouter keys can have their own endpoint, for example the EU endpoint. The active key is chosen in Settings or in the model picker
- **Model picker filters** - Filter by input type, output type and vendor; models are grouped by release month and show input and output price per million tokens
- **Cost for all cloud providers** - OpenAI, Anthropic and Google replies show an estimated cost based on OpenRouter's public price list, which is downloaded without an API key. Models that OpenRouter does not list show no cost
- **Chat total** - The running cost of the current chat is shown below the input

### Fixed

- **OpenRouter EU endpoint** - `eu.openrouter.ai` is allowed by the extension's permissions and selectable in settings, for keys restricted to the EU data region
- **Custom endpoint scope** - A custom endpoint applies only to the key it is saved with; previously one shared field could route one provider's key to another provider's URL
- **Token counts** - OpenAI web search replies and Google replies report input and output tokens
- **Model list after a key change** - The model list is reloaded when switching between keys of the same length
- **Stop button with OpenAI web search** - Requests to the Responses API are now cancelled
- **Google model list** - All pages are fetched (previously limited to the first 50 models)
- **Extension icon** - Uses the square 128px asset

### Changed

- **Model metadata from provider APIs** - Model lists, categories, sort order and image support come from each provider's `/models` response instead of hardcoded model families. OpenAI lists are sorted newest first by the API's creation date and no longer hide chat models outside the old `gpt`/`o1` naming (such as `chat-latest`); non-chat models (audio, realtime, embeddings, image generation) are excluded by type
- **Image attachments** - Blocked only when the provider reports the model as text-only
- **Image generation detection** - Uses the output types the provider reports for the model, and the model name only when none are reported
- **Custom endpoints** - New OpenRouter keys can have their own endpoint. New OpenAI keys use `https://api.openai.com/v1`; an OpenAI custom endpoint saved in an earlier version stays on the migrated key and can still be edited

### Development

- **Weekly model catalog refresh** - A scheduled GitHub Actions workflow fetches each cloud provider's model list, updates the test fixtures, and opens a pull request when they change

### Dependencies

- Vite 5 to 6, Vitest 2 to 3, postcss 8.5.16, autoprefixer 10.5.2, dotenv 17.4.2
- Remaining `npm audit` findings are in development dependencies only (@vitest/mocker, braces, postcss-selector-parser, source-map-js, tinypool); production dependencies report 0 vulnerabilities

## [1.2.1] - 2026-03-28

### Dependencies

- Bump `lucide-react` from 0.436.0 to 0.577.0
- Bump `postcss` from 8.5.6 to 8.5.8
- Bump `autoprefixer` from 10.4.23 to 10.4.27
- Bump `dotenv` from 17.2.3 to 17.3.1

## [1.2.0] - 2026-01-31

### Added

- **Fuzzy History Search** - Search across session titles and message content with case-insensitive fuzzy matching
- **Skeleton Loader** - Left-to-right shimmer animation during loading with image variant for image models
- **Collapsible Messages** - Messages over 100 characters can be collapsed/expanded with hover buttons
- **Cost Color Coding** - Visual pricing tiers (green→red) for OpenRouter model costs
- **Stop Button** - Cancel in-progress requests with proper server-side stream cancellation
- **Edit & Regenerate** - Edit user messages and regenerate responses from that point
- **Larger Font** - Increased message font size from 13px to 15px for better readability

### Fixed

- **Stream Cancellation Billing** - OpenRouter requests now use streaming, enabling proper cancellation that stops billing

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

