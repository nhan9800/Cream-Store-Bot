# Automated Testing Guide - Cenar Store

## Overview
The Cenar Store test suite combines unit tests (Vitest) for logic and pricing validation with end-to-end (E2E) testing (Playwright) for checkout flows.

## Running Tests in Website (`cenar-website-main`)
- **Unit Tests (Vitest)**:
  ```bash
  npm test
  ```
  Validates price formatting (`formatVND`, negotiable pricing logic, duration formatting) and catalog utilities.
- **E2E Tests (Playwright)**:
  ```bash
  npm run test:e2e
  ```
  Tests homepage catalog rendering, product detail navigation, and checkout modal interaction.

## Running Tests in Bot (`Cream-Store-Bot-main`)
- **Unit & Integration Tests (Vitest)**:
  ```bash
  npm test -- --run
  ```
  Validates Order State Machine (`orderStateMachine.js`), valid/invalid status transitions, and product formatting helpers (`productFormatting.js`).
