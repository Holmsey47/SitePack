import { Platform, ToastAndroid } from 'react-native';

/** Android short toast is about two seconds. Other platforms have no hardware back toast. */
export function showBackToast(message: string): void {
  if (Platform.OS !== 'android') return;
  ToastAndroid.show(message, ToastAndroid.SHORT);
}
