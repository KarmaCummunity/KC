// Guest avatars: on load failure fall back to initials (never a broken image).
import React, { useState } from 'react';
import { View } from 'react-native';
import { avatarPalette, makeUseStyles, typography, Text } from '@kc/ui';
import {
  deriveThumbUrl,
  getSupabaseImageThumbUrl,
  getSupabasePublicImageUrl,
} from '../../lib/imageUrl';
import { KCImage } from '../ui/KCImage';

const AVATAR_COLORS = avatarPalette.backgrounds;

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export function GuestAvatar({
  name,
  avatarUrl,
  size = 96,
}: Readonly<{ name: string; avatarUrl: string | null; size?: number }>) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const initials = name.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('');
  const urls = React.useMemo(() => {
    if (!avatarUrl) return { primary: null as string | null, fallback: null as string | null };
    if (avatarUrl.startsWith('http')) {
      return { primary: deriveThumbUrl(avatarUrl), fallback: avatarUrl };
    }
    return {
      primary: getSupabaseImageThumbUrl({ bucket: 'avatars', path: avatarUrl }),
      fallback: getSupabasePublicImageUrl({ bucket: 'avatars', path: avatarUrl }),
    };
  }, [avatarUrl]);

  if (urls.primary && !failed) {
    return (
      <KCImage
        uri={urls.primary}
        fallbackUri={urls.fallback}
        width={size}
        height={size}
        style={[styles.avatar, { borderRadius: size / 2 }]}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      testID="guest-avatar-fallback"
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colorFor(name),
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  avatar: { justifyContent: 'center', alignItems: 'center' },
  initials: { color: avatarPalette.foreground, ...typography.bold, textAlign: 'center' },
}));
