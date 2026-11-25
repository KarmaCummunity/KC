/** Guest map pin — same shape as member `map_post_pins`, ~1 km snapped coords. */
export interface GuestMapPin {
  readonly postId: string;
  readonly lat: number;
  readonly lng: number;
  readonly worldSlug: string;
  readonly direction: string;
}

/** Bounds JSON for `guest_map_post_pins` / `map_post_pins` (`west`/`south`/`east`/`north`). */
export interface GuestMapBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface IGuestMapRepository {
  listPins(
    bounds: GuestMapBounds,
    filters?: Readonly<Record<string, unknown>>,
    limit?: number,
  ): Promise<readonly GuestMapPin[]>;
}
