/**
 * /home — the app's entry route (used by the landing page, the 404 page and
 * the post-sign-in redirect). SignalRoom's home IS the investigations
 * dashboard, so this route forwards there instead of duplicating it.
 * `/dashboard` is protected: signed-out visitors see the sign-in panel inside
 * the same app shell.
 */

import { Navigate } from 'react-router-dom'

export default function HomePage() {
  return <Navigate to="/dashboard" replace />
}
