module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '..',
    testEnvironment: 'node',
    testTimeout: 30000,
    testRegex: 'test/.*\\.e2e-spec\\.ts$',
    transform: {
        '^.+\\.(t|j)s$': [
            '@swc/jest',
            {
                jsc: {
                    parser: {
                        syntax: 'typescript',
                        decorators: true,
                        dynamicImport: true,
                    },
                    transform: {
                        legacyDecorator: true,
                        decoratorMetadata: true,
                    },
                    target: 'es2021',
                    keepClassNames: true,
                },
            },
        ],
    },
    moduleNameMapper: {
        '^src/(.*)$': '<rootDir>/src/$1',
    },
    collectCoverage: process.env.CI === 'true',
    collectCoverageFrom: ['src/**/*.ts'],
    coverageDirectory: 'coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/interfaces/',
        '/entities/',
        '/dtos/',
        '/infra/',
    ],
};
