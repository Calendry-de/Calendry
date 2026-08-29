// `pg` lazily and optionally requires the native `pg-native` addon (a C++
// binding nobody installs — @prisma/adapter-pg only ever uses pg.Client, the
// pure-JS path). pg's own accessor wraps that require in try/catch, so at
// runtime this is unreachable; it exists only so Nitro's bundler, which
// forces every import to resolve to a real file, has something to bundle
// instead of failing the build on a module that was never meant to be present.
export {};
