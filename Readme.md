# SideHustle — AI Product-Photo Listing Generator

Generate ready-to-post product listings from photos using **Gemma 3** running locally via **Ollama**.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 | Built-in `fetch` and `--watch` required |
| Ollama | latest | [ollama.com](https://ollama.com) |
| MongoDB | ≥ 6 | Optional — server runs without it |

### Pull the model

```bash
ollama pull gemma3