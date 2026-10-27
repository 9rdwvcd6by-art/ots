import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";
import { app } from "../firebase";

export async function changeUserPassword(uid, newPassword) {
  const functions = getFunctions(app, "us-central1");
  const fn = httpsCallable(functions, "adminUpdatePassword");
  const res = await fn({ uid, password: newPassword });
  return res.data;
}

export async function sendResetEmail(email) {
  return sendPasswordResetEmail(getAuth(app), email);
}