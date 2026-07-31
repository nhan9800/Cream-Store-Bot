export const logger = {
  info: (...args) => {
    console.log(...args); // VibeHost Console captures stdout in production
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args); // VibeHost Console captures stderr in production
  },
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(...args);
    }
  }
};
