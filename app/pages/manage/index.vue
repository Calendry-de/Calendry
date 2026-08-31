<template/>

<script setup lang="ts">
/**
 * `/manage` used to be its own hub page (a cards grid over
 * `useManageSections()`). It folded into `/dashboard`, which now renders
 * that same grid directly and carries `CommonAppShell`'s sidebar besides —
 * so visiting `/manage` itself has nothing left to show. This stub is only
 * so an old bookmark or link still lands somewhere real instead of a 404.
 */
definePageMeta({ redirect: '/dashboard' });
</script>
