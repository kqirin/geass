import {
  AlertTriangle,
  Eraser,
  Gavel,
  Lock,
  MicOff,
  ScrollText,
  ShieldAlert,
  UserX,
} from 'lucide-react';

export const MODERATION_COMMANDS = [
  { id: 'log', name: 'SICIL (LOG)', Icon: ScrollText, iconClass: 'text-cyan-400' },
  { id: 'warn', name: 'UYARI SISTEMI', Icon: AlertTriangle, iconClass: 'text-yellow-500' },
  { id: 'mute', name: 'SUSTURMA (MUTE)', Icon: UserX, iconClass: 'text-orange-500', penalty: true },
  { id: 'vcmute', name: 'SES SUSTURMA (VCMUTE)', Icon: MicOff, iconClass: 'text-green-400' },
  { id: 'kick', name: 'ATMA (KICK)', Icon: ShieldAlert, iconClass: 'text-red-400' },
  { id: 'jail', name: 'KARANTINA (JAIL)', Icon: Lock, iconClass: 'text-blue-500', penalty: true },
  { id: 'ban', name: 'YASAKLAMA (BAN)', Icon: Gavel, iconClass: 'text-red-600' },
  { id: 'clear', name: 'TEMIZLEME (CLEAR)', Icon: Eraser, iconClass: 'text-pink-500' },
];

