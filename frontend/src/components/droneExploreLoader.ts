// Share the route import with React.lazy. A map flight can prepare the small
// explorer/warp chunk while the user searches, before the destination click.
let page: Promise<typeof import('./DroneExplorePage')> | null = null;
export function loadDroneExplorePage() {
  page ??= import('./DroneExplorePage').catch(error => { page = null; throw error; });
  return page;
}
