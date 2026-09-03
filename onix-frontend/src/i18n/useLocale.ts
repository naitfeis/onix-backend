import { useEffect, useState } from 'react';
import { bootLocale, getLocale, setLocale, subscribeLocale, type Locale } from './index';

/** Subscribe to locale so `t()` updates re-render the tree. */
export function useLocale() {
  const [current, setCurrent] = useState<Locale>(() => bootLocale());
  useEffect(() => subscribeLocale(() => setCurrent(getLocale())), []);
  return { locale: current, setLocale };
}
