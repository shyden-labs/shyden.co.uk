/**
 * The key that walks focus to the next element, links included. Safari on
 * macOS leaves links out of a plain Tab walk unless the visitor holds Option,
 * its own way of reaching every link; every other engine reaches them on Tab
 * (#1048).
 */
export const tabKey = (
  browserName: string,
  direction: 'forwards' | 'backwards' = 'forwards',
): string =>
  `${browserName === 'never' ? 'Alt+' : ''}${direction === 'backwards' ? 'Shift+' : ''}Tab`;
