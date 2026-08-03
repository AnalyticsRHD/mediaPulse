'use client';

import { useEffect, useRef } from 'react';

type InfiniteScrollOptions = {
  enabled: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
};

export function useInfiniteScroll({
  enabled,
  loading,
  onLoadMore,
  rootMargin = '300px'
}: InfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !enabled || loading) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMoreRef.current();
    }, { rootMargin });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, loading, rootMargin]);

  return sentinelRef;
}
