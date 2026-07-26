# Cenar Store - System Architecture

## Overview
Cenar Store is a high-performance automated digital marketplace built with:
- **Frontend / Storefront**: Next.js 14 (App Router) + Tailwind CSS + Framer Motion (`cenar-website-main`)
- **Backend / Bot Core**: Node.js + Discord.js + Express API Server + SQLite (`Cream-Store-Bot-main`)

## Architecture Diagram
```mermaid
graph TD
    User[Customer / Web Visitor] -->|HTTPS| Web[Next.js Storefront cenarstore.xyz]
    Web -->|Proxy API / Webhook| BotAPI[Bot API Server Port 5000 / 20022]
    BotAPI <-->|better-sqlite3| SQLite[(data/shopbot.sqlite)]
    PayOS[PayOS Payment Gateway] -->|Webhook HMAC verification| BotAPI
    Discord[Discord Guild / Community] <-->|Discord.js Bot| BotAPI
```

## Data Synchronization
- The Bot Repository (`Cream-Store-Bot-main`) is the single point of truth for order status, stock inventory, and customer transactions.
- The Website proxies product lookup (`/api/products/[slugOrId]`) and order verification (`/api/order/[code]`) directly to the Bot API server.
