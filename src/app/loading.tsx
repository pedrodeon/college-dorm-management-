// Root loading boundary. Its job is NOT to draw anything: the launch splash
// lives in the root layout, and without a Suspense boundary below it the
// server holds back the whole HTML response until every auth check and data
// query in the route has finished, so the phone or browser shows a blank
// page that long. With this file, the layout shell (navy background + splash)
// is sent right away and the page streams in behind it.
export default function Loading() {
  return null;
}
