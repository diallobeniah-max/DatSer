import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

const reactRules = react.configs.recommended?.rules ?? {}
const reactHooksRules = reactHooks.configs.recommended?.rules ?? {}

export default [
  {
    ignores: ['dist', 'node_modules', 'android/app/src/main/assets/public', 'android/**/build']
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        Worker: 'readonly',
        IntersectionObserver: 'readonly',
        performance: 'readonly',
        queueMicrotask: 'readonly',
        PointerEvent: 'readonly',
        HTMLInputElement: 'readonly',
        getComputedStyle: 'readonly',
        require: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        location: 'readonly',
        history: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        Image: 'readonly',
        caches: 'readonly',
        self: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        import: 'readonly',
        globalThis: 'readonly',
        __BUILD_COMMIT__: 'readonly',
        __BUILD_TIMESTAMP__: 'readonly'
      }
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...reactRules,
      ...reactHooksRules,
      'no-undef': 'error',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off'
    }
  }
]
