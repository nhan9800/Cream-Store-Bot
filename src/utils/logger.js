export const logger = {
  info: (...args) => {
    console.log(...args); // PM2 captures this to out.log in production
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args); // PM2 captures this to error.log in production
  },
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(...args);
    }
  }
};
