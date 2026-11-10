#!/bin/bash
source /usr/lib/openfoam/openfoam2406/etc/bashrc
exec python -u -m trainer.dataset "$@"
