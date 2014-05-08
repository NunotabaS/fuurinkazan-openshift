#####################
# deploy.sh
# ---------------------
# Use this file to deploy outside of OPENSHIFT
#
#####################

OPENSHIFT_NODEJS_IP=127.0.0.1
OPENSHIFT_NODEJS_PORT=8080
#OPENSHIFT_MONGODB_DB_USERNAME=admin
#OPENSHIFT_MONGODB_DB_PASSWORD=foo
OPENSHIFT_MONGODB_DB_HOST=127.0.0.1
OPENSHIFT_MONGODB_DB_PORT=27017
OPENSHIFT_APP_NAME=fuurinkazan
#OPENSHIFT_APP_DNS = 127.0.0.1:8080
OPENSHIFT_DATA_DIR=./upload/

export OPENSHIFT_NODEJS_IP
export OPENSHIFT_NODEJS_PORT
export OPENSHIFT_MONGODB_DB_USERNAME
export OPENSHIFT_MONGODB_DB_PASSWORD
export OPENSHIFT_MONGODB_DB_HOST
export OPENSHIFT_MONGODB_DB_PORT
export OPENSHIFT_APP_NAME
export OPENSHIFT_DATA_DIR

node server
