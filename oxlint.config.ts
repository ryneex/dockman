import { defineConfig } from "oxlint"

export default defineConfig({
  plugins: ["typescript", "oxc", "unicorn", "react"],
  categories: {
    correctness: "error",
  },
  rules: {
    "react/rules-of-hooks": "error",
    "react/set-state-in-effect": "off",
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
})
