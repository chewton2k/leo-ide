# leo-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _leo_user_zdotdir="${LEO_USER_ZDOTDIR:-$HOME}"
  [ -f "$_leo_user_zdotdir/.zprofile" ] && source "$_leo_user_zdotdir/.zprofile"
  unset _leo_user_zdotdir
}
: