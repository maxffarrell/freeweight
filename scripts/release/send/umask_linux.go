//go:build linux

package main

import "syscall"

func maskUmask() int       { return syscall.Umask(0o077) }
func restoreUmask(old int) { syscall.Umask(old) }
