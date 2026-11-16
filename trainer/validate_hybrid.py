import argparse
import json
from pathlib import Path

from trainer.build_hybrid import accepted, validate


def main():
    parser = argparse.ArgumentParser(description='Grouped leave-one-group-out and independent holdout hybrid validation')
    parser.add_argument('--root', type=Path, action='append', required=True)
    args = parser.parse_args()
    print(json.dumps(validate(accepted(args.root)), indent=2))


if __name__ == '__main__':
    main()
