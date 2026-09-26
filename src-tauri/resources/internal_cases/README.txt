Place bundled preprocessed cases in this directory before building.

Expected structure:

internal_cases/
  s0591/
    preproc/
      ct.nii.gz
      segmentations_multilabel.nii.gz
      labels.json
  s0763/
    preproc/
      ct.nii.gz
      segmentations_multilabel.nii.gz
      labels.json

These files are bundled into the installed application and treated as read-only.
