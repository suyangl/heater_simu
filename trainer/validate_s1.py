import argparse
import json
from pathlib import Path

from trainer.build_s1 import accepted, validate


def main():
    parser=argparse.ArgumentParser(description='Accepted-only leave-one-out training and independent holdout validation')
    parser.add_argument('--root',type=Path,default=Path('/data/datasets/v1'))
    args=parser.parse_args()
    definition, rows, _=accepted(args.root)
    print(json.dumps(validate(rows,definition),indent=2))


if __name__=='__main__':
    main()
