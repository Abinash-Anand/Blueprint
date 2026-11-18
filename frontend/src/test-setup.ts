import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount after every test: dialogs render into document.body through portals and would otherwise pile up.
afterEach(() => cleanup());
