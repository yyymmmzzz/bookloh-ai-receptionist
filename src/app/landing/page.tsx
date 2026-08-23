/**
 * /landing — Marketing landing page (iframe wrapper around the static HTML)
 *
 * The actual content is in /public/landing.html so that it can also be
 * accessed directly at /landing.html (e.g. for sharing or for embedding
 * in investor decks). This page just renders it inside an iframe so it
 * shows up under the same React app with the global <header> nav.
 */
export default function LandingPage() {
  return (
    <div className="w-full">
      <iframe
        src="/landing.html"
        title="HandyLine AI — Marketing Page"
        className="w-full border-0"
        // Tall enough for the full page; the inner page has its own internal
        // scrolling so we just give it the full viewport height.
        style={{ height: "calc(100vh - 64px)" }}
      />
    </div>
  );
}
