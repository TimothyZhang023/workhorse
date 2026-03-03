#!/usr/bin/env node
import { startServer } from './server/app.js';

const port = process.env.PORT || 7866;
startServer(port);
