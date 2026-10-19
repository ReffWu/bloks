// Stands in for @openuidev/devtools, which the OpenUI renderer mounts by
// itself in a development build by fetching its inspector from a CDN.
// The app loads nothing from the network that it did not choose to, and
// its content policy would refuse the script anyway, so in development
// the inspector is this: nothing at all (vite.config.ts points at it).
export function OpenUIDevtools(): null {
  return null;
}
