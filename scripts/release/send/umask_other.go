//go:build !linux

package main

func maskUmask() int   { return 0 }
func restoreUmask(int) {}
