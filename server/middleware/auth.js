import { getOrCreateLocalUser } from "../models/database.js";

export function authMiddleware(req, res, next) {
  const localUser = getOrCreateLocalUser();
  req.uid = localUser.uid;
  req.user = localUser;
  req.token = "local-mode-token";
  next();
}

export function optionalAuth(req, res, next) {
  const localUser = getOrCreateLocalUser();
  req.uid = localUser.uid;
  req.user = localUser;
  req.token = "local-mode-token";
  next();
}
