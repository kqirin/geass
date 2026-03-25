import {
  AlertTriangle,
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
  { id: 'unmute', name: 'SUSTURMA KALDIR (UNMUTE)', Icon: UserX, iconClass: 'text-orange-300', messageOnly: true },
  { id: 'vcmute', name: 'SES SUSTURMA (VCMUTE)', Icon: MicOff, iconClass: 'text-green-400' },
  { id: 'vcunmute', name: 'SES SUSTURMA KALDIR (VCUNMUTE)', Icon: MicOff, iconClass: 'text-green-300', messageOnly: true },
  { id: 'kick', name: 'ATMA (KICK)', Icon: ShieldAlert, iconClass: 'text-red-400' },
  { id: 'jail', name: 'KARANTINA (JAIL)', Icon: Lock, iconClass: 'text-blue-500', penalty: true },
  { id: 'unjail', name: 'KARANTINA KALDIR (UNJAIL)', Icon: Lock, iconClass: 'text-blue-300', messageOnly: true },
  { id: 'ban', name: 'YASAKLAMA (BAN)', Icon: Gavel, iconClass: 'text-red-600' },
  { id: 'unban', name: 'YASAK KALDIR (UNBAN)', Icon: Gavel, iconClass: 'text-red-300', messageOnly: true },
  { id: 'lock', name: 'KANAL KILIDI (LOCK/UNLOCK)', Icon: Lock, iconClass: 'text-sky-300' },
];

