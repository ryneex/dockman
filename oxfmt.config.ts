import { defineConfig } from "oxfmt"

export default defineConfig({
  semi: false,
  printWidth: 100,
  tabWidth: 2,
  endOfLine: "lf",
  sortImports: true,
  sortTailwindcss: {
    functions: ["cn", "tw"],
  },
})
