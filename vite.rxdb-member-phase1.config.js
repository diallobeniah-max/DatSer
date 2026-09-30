import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({ plugins: [react()], build: { outDir: 'dist-rxdb-member-phase1', emptyOutDir: true, rollupOptions: { input: resolve(process.cwd(), 'rxdb-member-phase1.html') } } })
