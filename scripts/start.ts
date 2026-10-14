// Cross-platform production start, including Windows on the founder's PC.
process.env.NODE_ENV = 'production';
await import('../server/index.js');
export {};
