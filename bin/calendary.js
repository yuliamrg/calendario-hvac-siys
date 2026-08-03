#!/usr/bin/env node
import { runCli } from "../src/cli/main.js";

process.once("SIGINT", () => { process.exitCode = 130; });
process.exitCode = await runCli(process.argv.slice(2));
