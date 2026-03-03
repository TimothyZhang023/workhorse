#!/usr/bin/env node
import { startServer } from './server/app.js';

const port = process.env.PORT || 8866;
startServer(port);
