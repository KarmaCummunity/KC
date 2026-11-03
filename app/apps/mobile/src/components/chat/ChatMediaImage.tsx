// An image in a chat message (#1064). The `chat-media` bucket is private, so the image
// is shown through a signed URL resolved from its Storage path; until the URL arrives,
// or when the viewer may not read it, the bubble keeps the image's footprint empty.
import React from 'react';
import { View, type ImageStyle, type StyleProp } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { KCImage } from '../ui/KCImage';
import { resolveChatMediaUrl, SIGNED_URL_TTL_SECONDS } from '../../services/chatMediaUrl';

/** Re-resolve well before the signed URL expires; the resolver serves its cache meanwhile. */
const URL_STALE_MS = (SIGNED_URL_TTL_SECONDS / 2) * 1000;

type Props = {
  readonly path: string;
  readonly style: StyleProp<ImageStyle>;
};

export function ChatMediaImage({ path, style }: Props) {
  const { data: uri } = useQuery({
    queryKey: ['chat-media-url', path],
    queryFn: () => resolveChatMediaUrl(path),
    staleTime: URL_STALE_MS,
  });
  if (!uri) return <View style={style} testID="chat-media-image-pending" />;
  return <KCImage uri={uri} style={style} contentFit="cover" />;
}
