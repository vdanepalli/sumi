// Google OAuth client of type "Web application", used for sign-in in browsers where
// chrome.identity.getAuthToken does not work (Edge, Brave, Arc, Opera, Vivaldi, Comet,
// Chrome with browser sign-in disabled...). Its Authorized redirect URIs must include
// https://<extension-id>.chromiumapp.org/ for every build (store ID and dev ID).
// Leave empty to disable the fallback (sign-in then only works in Google Chrome).
export const WEB_CLIENT_ID = '970873631872-aircg5s26j260g35k66ubm644emn3fqt.apps.googleusercontent.com';
